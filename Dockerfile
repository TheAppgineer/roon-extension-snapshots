ARG build_arch=amd64

FROM multiarch/alpine:${build_arch}-v3.12

RUN addgroup -g 1000 node && \
    adduser -u 1000 -G node -s /bin/sh -D node && \
    apk add --no-cache nodejs

WORKDIR /home/node

COPY install.sh snapshots.js installer-lib.js package.json repository.json LICENSE /home/node/

RUN apk add --no-cache tzdata npm git bash && \
    npm install && \
    ./install.sh && \
    rm install.sh && \
    apk del git bash && \
    mkdir -p .config && \
    ln -s .config/config.json config.json && \
    ln -s .config/running.json running.json && \
    chown -R node:node .

VOLUME /home/node/.config

USER node

CMD [ "node", "." ]
