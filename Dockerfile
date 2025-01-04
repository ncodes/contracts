FROM node:20-bookworm

COPY . /usr/src/app

WORKDIR /usr/src/app

RUN yarn install --non-interactive --frozen-lockfile

COPY ./docker/entrypoint.sh /usr/local/bin

ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]