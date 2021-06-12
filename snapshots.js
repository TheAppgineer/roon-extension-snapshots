// Copyright 2017 - 2021 The Appgineer
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

var RoonApi               = require("node-roon-api"),
    RoonApiSettings       = require('node-roon-api-settings'),
    RoonApiStatus         = require('node-roon-api-status'),
    ApiExtensionInstaller = require('./installer-lib');

const ACTION_NO_CHANGE = 0;

var pending_actions = {};
var category_list = [];
var extension_list = [];
var action_list = [];
var timeout_id = null;
var ping_timer_id = null;
var watchdog_timer_id = null;
var last_message;
var last_is_error;

var roon = new RoonApi({
    extension_id:        'com.theappgineer.extension-snapshots',
    display_name:        "Extension Snapshots",
    display_version:     "0.1.2",
    publisher:           'The Appgineer',
    email:               'theappgineer@gmail.com',
    website:             'https://community.roonlabs.com/t/roon-extension-manager-v1-0-beta-program/151438',

    core_found: function(core) {
        console.log('Core found:', core.display_name);
        clear_watchdog_timer();
        setup_ping_timer();
    },
    core_lost: function(core) {
        console.log('Core lost:', core.display_name);
        clear_ping_timer();
        setup_watchdog_timer();
    }
});

var ext_settings = roon.load_config("settings") || {
};

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        pending_actions = {};           // Start off with a clean list
        cb(makelayout(ext_settings));
    },
    save_settings: function(req, isdryrun, settings) {
        update_pending_actions(settings.values);

        let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            ext_settings = l.values;
            svc_settings.update_settings(l);
            roon.save_config("settings", ext_settings);

            perform_pending_actions();

            if (installer.is_idle()) {
                installer.set_on_activity_changed();
                installer.set_log_state(ext_settings.logging);
            } else {
                installer.set_on_activity_changed(() => {
                    installer.set_on_activity_changed();
                    installer.set_log_state(ext_settings.logging);
                });
            }
        }
    }
});

var svc_status = new RoonApiStatus(roon);

var installer = new ApiExtensionInstaller({
    started: function() {
        roon.start_discovery();
    },
    repository_changed: function(values) {
        category_list = values;
    },
    status_changed: function(message, is_error) {
        set_status(message, is_error);
    }
});

roon.init_services({
    provided_services: [ svc_settings, svc_status ]
});

function makelayout(settings) {
    let l = {
        values:    settings,
        layout:    [],
        has_error: false
    };
    let category = {
        type:    "dropdown",
        title:   "Category",
        values:  [{ title: "(select category)", value: undefined }],
        setting: "selected_category"
    };
    let selector = {
        type:    "dropdown",
        title:   "Extension",
        values:  [{ title: "(select extension)", value: undefined }],
        setting: "selected_extension"
    };
    let extension = {
        type:    "group",
        title:   "(no extension selected)",
        items:   []
    };
    let status_string = {
        type:    "label"
    };
    let action = {
        type:    "dropdown",
        title:   "Action",
        values:  [{ title: "(select action)", value: undefined }],
        setting: "action"
    };

    installer.set_on_activity_changed(() => {
        svc_settings.update_settings(l);
    });

    const category_index = settings.selected_category;
    category.values = category.values.concat(category_list);

    if (category_index !== undefined && category_index < category_list.length) {
        extension_list = installer.get_extensions_by_category(category_index);
        selector.values = selector.values.concat(extension_list);
        selector.title = category_list[category_index].title + ' Extension';

        let name = undefined;

        for (let i = 0; i < extension_list.length; i++) {
            if (extension_list[i].value == settings.selected_extension) {
                name = settings.selected_extension;
                break;
            }
        }

        if (name !== undefined) {
            const status  = installer.get_status(name);
            const details = installer.get_details(name);
            const actions = installer.get_actions(name);
            let author = {
                type: "label"
            };

            if (details.packager) {
                author.title  = "Developed by: " + details.author;
                author.title += "\nPackaged by:   " + details.packager;
            } else {
                author.title = "by: " + details.author;
            }

            if (details.description) {
                extension.title = details.description;
            } else {
                extension.title = "(no description)";
            }

            status_string.title  = status.state.toUpperCase();
            status_string.title += (status.version ? ": version " + status.version : "");

            if (installer.is_idle(name)) {
                if (is_pending(name)) {
                    action_list = [{ title: 'Revert Action', value: ACTION_NO_CHANGE }];
                } else {
                    action_list = actions.actions;
                }

                action.values = action.values.concat(action_list);
            } else {
                action.values[0].title = '(in progress...)';
            }

            extension.items.push(author);
            extension.items.push(status_string);
            extension.items.push(action);
        } else {
            settings.selected_extension = undefined;
        }
    } else {
        settings.selected_category = undefined;
        settings.selected_extension = undefined;
    }

    l.layout.push({
        type:  "group",
        title: "[EXTENSION]",
        items: [category, selector, extension]
    });

    l.layout.push({
        type:    "group",
        title:   "[PENDING ACTIONS]",
        items:   [{
            type : "label",
            title: get_pending_actions_string()
        }]
    });

    return l;
}

function is_pending(name) {
    return pending_actions[name];
}

function update_pending_actions(settings) {
    const name = settings.selected_extension;
    const action = settings.action;

    if (action !== undefined) {
        if (action === ACTION_NO_CHANGE) {
            // Remove action from pending_actions
            delete pending_actions[name];
        } else {
            // Update pending actions
            for (let i = 0; i < action_list.length; i++) {
                if (action_list[i].value === action) {
                    let friendly = action_list[i].title + " " + installer.get_details(name).display_name;

                    pending_actions[name] = {
                        action,
                        friendly
                    };

                    break;
                }
            }
        }

        // Cleanup
        delete settings["action"];
    }
}

function get_pending_actions_string() {
    let pending_actions_string = ""

    for (const name in pending_actions) {
        pending_actions_string += pending_actions[name].friendly + "\n";
    }

    if (!pending_actions_string) {
        pending_actions_string = "(none)";
    }

    return pending_actions_string;
}

function perform_pending_actions() {
    for (const name in pending_actions) {
        installer.perform_action(pending_actions[name].action, name, pending_actions[name].options);

        // Consume action
        delete pending_actions[name];
    }
}

function setup_ping_timer() {
    if (!ping_timer_id) {
        ping_timer_id = setInterval(ping, 60000);
        console.log('Ping timer set');
    }
}

function ping() {
    // Check if the Roon API is still running fine by refreshing the status message
    svc_status.set_status(last_message, last_is_error);
}

function clear_ping_timer() {
    if (ping_timer_id) {
        clearInterval(ping_timer_id);
        console.log('Ping timer cleared');
    }
}

function setup_watchdog_timer() {
    clear_watchdog_timer();

    watchdog_timer_id = setTimeout(installer.restart_manager, 30000);
    console.log('Watchdog timer set');
}

function clear_watchdog_timer() {
    if (watchdog_timer_id) {
        clearTimeout(watchdog_timer_id);
        console.log('Watchdog timer cleared');
    }
}

function set_status(message, is_error) {
    svc_status.set_status(message, is_error);

    last_message = message;
    last_is_error = is_error;
}

function init() {
    let os = require("os");
    let hostname = os.hostname().split(".")[0];

    roon.extension_reginfo.extension_id += "." + hostname;
    roon.extension_reginfo.display_name += " @" + hostname;
}

init();
