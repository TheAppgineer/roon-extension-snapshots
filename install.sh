#!/bin/bash

PWD=$(pwd)
PREFIX=$(npm config get prefix)

declare -a authors=( \
    "bsc101" \
    "bsc101" \
    "docbobo" \
    "docbobo" \
    "docbobo" \
    "marcelveldt" \
    "nugget" \
    "pluggemi" \
    "varunrandery" \
)

declare -a extensions=( \
    "roon-extension-itroxs" \
    "roon-extension-rotel" \
    "roon-extension-arcam" \
    "roon-extension-denon" \
    "roon-extension-harmony" \
    "roon-extension-onkyo" \
    "roon-community-dj" \
    "roon-web-controller" \
    "roon-remote" \
)

for i in "${!extensions[@]}"
do
    echo ${authors[$i]}/${extensions[$i]}
    npm install -g https://github.com/${authors[$i]}/${extensions[$i]}.git
    cd $PREFIX/lib/node_modules/${extensions[$i]}
    mkdir -p /home/node/.config/${extensions[$i]}
    ln -s /home/node/.config/${extensions[$i]}/config.json config.json
    cd $PWD
done
