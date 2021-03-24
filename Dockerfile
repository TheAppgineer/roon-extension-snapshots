FROM node:12.16.3-alpine

COPY install.sh snapshots.js installer-lib.js package.json repository.json LICENSE /home/node/

WORKDIR /home/node

RUN apk add --no-cache tzdata git bash && \
    npm install && \
    ./install.sh && \
    rm install.sh && \
    apk del bash && \
    mkdir -p .config && \
    ln -s .config/config.json config.json && \
    ln -s .config/running.json running.json && \
    chown -R node:node .

VOLUME /home/node/.config

USER node

CMD [ "node", "." ]
