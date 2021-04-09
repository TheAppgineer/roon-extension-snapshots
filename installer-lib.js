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

const MANAGER_NAME = "roon-extension-manager";

const ACTION_START = 1;
const ACTION_RESTART = 2;
const ACTION_STOP = 3;

const action_strings = [
    '',
    'Start',
    'Restart',
    'Stop'
];

const module_dir = 'node_modules/';
const perform_restart = 67;

const fs = require('fs');
const ApiExtensionRunner = require('node-api-extension-runner');

var runner = undefined;
var extension_root;
var repos = [];
var index_cache = {};
var npm_installed = {};
var session_error;

var repository_cb;
var status_cb;
var on_activity_changed;

function ApiExtensionInstaller(callbacks) {
    process.on('SIGTERM', _handle_signal);
    process.on('SIGINT', _handle_signal);
    process.on('SIGBREAK', _handle_signal);

    if (callbacks) {
        if (callbacks.repository_changed) {
            repository_cb = callbacks.repository_changed;
        }
        if (callbacks.status_changed) {
            status_cb = callbacks.status_changed;
        }
    }

    _query_installs(() => {
        _set_status("Starting Roon Extension Manager...", false);

        _load_repository();

        callbacks.started && callbacks.started();
    });
}

ApiExtensionInstaller.prototype.get_extensions_by_category = function(category_index) {
    const extensions = repos[category_index].extensions;
    let values = [];

    // Collect extensions
    for (let i = 0; i < extensions.length; i++) {
        if (extensions[i].display_name) {
            const name = _get_name(extensions[i]);

            values.push({
                title: extensions[i].display_name,
                value: name
            });

            // Take the opportunity to cache the item
            index_cache[name] = [category_index, i];
        }
    }

    values.sort(_compare);

    return values;
}

ApiExtensionInstaller.prototype.update = function(name) {
}

ApiExtensionInstaller.prototype.update_all = function() {
}

ApiExtensionInstaller.prototype.restart_manager = function() {
}

/**
 * Returns the status of an extension identified by name
 *
 * @param {String} name - The name of the extension according to its package.json file
 * @returns {('not_installed'|'installed'|'stopped'|'terminated'|'running')} - The status of the extension
 */
ApiExtensionInstaller.prototype.get_status = function(name) {
    // npm.get_status(name)
    const version = npm_installed[name];

    let state = (version ? 'installed' : 'not_installed');

    if (state == 'installed' && runner) {
        state = runner.get_status(name);
    }

    return {
        state:   state,
        version: version,
    };
}

ApiExtensionInstaller.prototype.get_details = function(name) {
    const index_pair = _get_index_pair(name);
    const extension = repos[index_pair[0]].extensions[index_pair[1]];

    return {
        author:       extension.author,
        packager:     extension.packager,
        display_name: extension.display_name,
        description:  extension.description
    };
}

ApiExtensionInstaller.prototype.get_actions = function(name) {
    const state = ApiExtensionInstaller.prototype.get_status.call(this, name).state;
    let actions = [];

    if (state != 'not_installed') {
        if (state == 'running') {
            actions.push(_create_action_pair(ACTION_RESTART));
            actions.push(_create_action_pair(ACTION_STOP));
        } else {
            actions.push(_create_action_pair(ACTION_START));
        }
    }

    return {
        actions
    };
}

ApiExtensionInstaller.prototype.get_features = function() {
}

ApiExtensionInstaller.prototype.set_log_state = function(logging) {
}

ApiExtensionInstaller.prototype.perform_action = function(action, name, options) {
    switch (action) {
        case ACTION_START:
            _start(name, false);
            break;
        case ACTION_RESTART:
            _restart(name, false);
            break;
        case ACTION_STOP:
            _stop(name, true);
            break;
    }
}

ApiExtensionInstaller.prototype.set_on_activity_changed = function(cb) {
    on_activity_changed = cb;
}

ApiExtensionInstaller.prototype.is_idle = function(name) {
    return true;
}

ApiExtensionInstaller.prototype.get_logs_archive = function(cb) {
    cb && cb();
}

function _create_action_pair(action) {
    return {
        title: action_strings[action],
        value: action
    };
}

function _load_repository() {
    repos.length = 0;       // Cleanup first

    _add_to_repository('./repository.json');

    if (repos.length) {
        let values = [];

        // Collect extension categories
        for (let i = 0; i < repos.length; i++) {
            if (repos[i].display_name) {
                values.push({
                    title: repos[i].display_name,
                    value: i
                });
            }
        }

        npm_installed = _get_npm_installed_extensions(npm_installed);
        console.log(npm_installed);

        _set_status("Extension Repository loaded", false);

        runner = new ApiExtensionRunner(MANAGER_NAME, (running) => {
            // Start previously running extensions
            for (let i = 0; i < running.length; i++) {
                if (npm_installed[running[i]]) {
                    _start(running[i]);
                }
            }
        });

        repository_cb && repository_cb(values);
    } else {
        _set_status("Extension Repository not found", true);

        repository_cb && repository_cb();
    }
}

function _add_to_repository(file) {
    if (file.includes('.json')) {
        const new_repo = _read_JSON_file_sync(file);

        if (new_repo) {
            for (let i = 0; i < new_repo.length; i++) {
                let filtered = {
                    display_name: new_repo[i].display_name,
                    extensions: []
                };
                let j;

                // Is the install type available and active?
                for (j = 0; j < new_repo[i].extensions.length; j++) {
                    if (new_repo[i].extensions[j].repository) {
                        filtered.extensions.push(new_repo[i].extensions[j]);
                    }
                }

                // Does category already exist?
                for (j = 0; j < repos.length; j++) {
                    if (repos[j].display_name == filtered.display_name) {
                        break;
                    }
                }

                if (filtered.extensions.length) {
                    if (j === repos.length) {
                        // New category
                        repos.push(filtered);
                    } else {
                        // Add to existing category
                        repos[j].extensions = repos[j].extensions.concat(filtered.extensions);
                    }
                }
            }
        }
    }
}

function _get_npm_installed_extensions(installed) {
    let installed_extensions = {};

    if (installed) {
        for (const name in installed) {
            // Only packages that are included in the repository
            if (_get_index_pair(name)) {
                installed_extensions[name] = installed[name];
            }
        }
    }

    return installed_extensions;
}

function _compare(a, b) {
    if (a.title.toLowerCase() < b.title.toLowerCase()) {
        return -1;
    }
    if (a.title.toLowerCase() > b.title.toLowerCase()) {
        return 1;
    }
    return 0;
}

function _get_name(extension) {
    let name;

    if (extension.repository) {
        // npm.get_name(extension.repository)
        let substrings = extension.repository.url.split(':');

        if (substrings && substrings[0] == 'https') {
            substrings = substrings[1].split('.');

            if (substrings[2].indexOf('git') === 0) {
                substrings = substrings[1].split('/');
                name = substrings[2];
            }
        }
    }

    return name;
}

function _get_index_pair(name) {
    let index_pair = index_cache[name];

    if (!index_pair) {
        for (let i = 0; i < repos.length; i++) {
            const extensions = repos[i].extensions;

            for (let j = 0; j < extensions.length; j++) {
                const entry_name = _get_name(extensions[j]);

                index_cache[entry_name] = [i, j];

                if (entry_name == name) {
                    index_pair = index_cache[entry_name];
                    break;
                }
            }
        }
    }

    return index_pair;
}

function _start(name) {
    if (npm_installed[name]) {
        // npm.start()
        const cwd = extension_root + module_dir + name;

        runner.start(name, cwd, '.', 'ignore', (code, signal, user) => {
            if (user) {
                _set_status("Stopped: " + name, false);
            } else if (code !== null) {
                const WINDOWS_USER_BREAK = 3221225786;

                _set_status("Process terminated: " + name + " (" + code +")", code && code != WINDOWS_USER_BREAK);
            } else if (signal) {
                _set_status("Process terminated: " + name + " (" + signal +")", false);
            }
        });
    }

    _set_status("Started: " + name, false);
}

function _restart(name, log) {
    _stop(name, false, () => {
        _start(name, log);
    });
}

function _stop(name, user, cb) {
    _set_status("Terminating process: " + name + "...", false);

    if (npm_installed[name]) {
        // npm.stop()
        if (runner && runner.get_status(name) == 'running') {
            if (user) {
                runner.stop(name, cb);
            } else {
                runner.terminate(name, cb);
            }
        } else if (cb) {
            cb();
        }
    }
}

function _terminate(exit_code, log) {
    if (runner) {
        runner.prepare_exit(() => {
            if (exit_code) {
                process.exit(exit_code);
            } else {
                process.exit(0);
            }
        });
    } else {
        if (exit_code) {
            process.exit(exit_code);
        } else {
            process.exit(1);
        }
    }
}

function _handle_signal(signal) {
    _terminate();
}

function _query_installs(cb, name) {
    let command = 'npm list -g --depth=0';

    if (name) {
        command += ' ' + name;
    }

    const exec = require('child_process').exec;
    exec(command, (err, stdout, stderr) => {
        const lines = stdout.split('\n');
        let peer_deps;
        let other_error = false;

        extension_root = lines[0] + '/';

        if (name && err) {
            const err_lines = stderr.split('\n');

            for (let i = 0; i < err_lines.length; i++) {
                const err_line = err_lines[i].split(': ');

                if (err_line[0] == 'npm ERR! peer dep missing' || err_line[0] == 'npm ERR! missing') {
                    if (!peer_deps) peer_deps = {};

                    peer_deps[err_line[1].split(', ')[0]] = undefined;
                } else if (err_lines[i]) {
                    console.error(err_lines[i]);
                    other_error = true;
                }
            }
        }

        if (other_error) {
            _set_status("Extension query failed", true);

            cb && cb();
        } else {
            // Process global list output (npm list -g)
            if (name) {
                delete npm_installed[name];
            } else {
                npm_installed = {};
            }

            for (let i = 1; i < lines.length; i++) {
                let name_version = lines[i].split(' ')[1];
                if (name_version) {
                    name_version = name_version.split('@');
                    npm_installed[name_version[0]] = name_version[1];
                }
            }

            if (repos.length) {
                // Only packages that are included in the repository
                npm_installed = _get_npm_installed_extensions(npm_installed);
            }

            cb && cb(peer_deps ? Object.keys(peer_deps) : undefined);
        }
    });
}

function _set_status(message, is_error) {
    const date = new Date();

    if (is_error) {
        console.error(date.toISOString(), '- Err:', message);
    } else {
        console.log(date.toISOString(), '- Inf:', message);
    }

    if (!session_error && status_cb) {
        status_cb(message, is_error);
    }

    if (session_error === false && is_error) {
        session_error = true;
    }
}

function _read_JSON_file_sync(file) {
    let parsed = undefined;

    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.toString().includes('SyntaxError')) {
            console.error(err);
        } else if (err.code !== 'ENOENT') {
            throw err;
        }
    }

    return parsed;
}

exports = module.exports = ApiExtensionInstaller;
