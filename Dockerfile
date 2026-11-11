# Pinned Node 24.22.2 LTS. node:sqlite DatabaseSync timeout option exists on this
# release. Do not float the tag. See deploy/OPERATOR.md before changing it.
FROM node:24.22.2-bookworm-slim

WORKDIR /app

# The process stays root so it can read the host file /srv/autob2b/secrets.env
# mounted read-only as root:root mode 0600. server.js still refuses to listen
# on anything except loopback when ENFORCE_LOOPBACK=1.
ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=10000 \
    COOKIE_SECURE=1 \
    TRUST_PROXY=loopback \
    ENFORCE_LOOPBACK=1 \
    REQUIRE_ADMIN=1 \
    DB_FILE=/data/autob2b.sqlite \
    UPLOAD_DIR=/uploads \
    SECRETS_FILE=/secrets/secrets.env

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]
