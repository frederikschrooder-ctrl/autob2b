#!/usr/bin/env bash
# Local process on 127.0.0.1 only. Does not seed accounts or demo inventory.
cd "$(dirname "$0")"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4310}"
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then echo "Already running (pid $(cat server.pid))"; exit 0; fi
setsid nohup node server.js >> server.log 2>&1 < /dev/null &
echo $! > server.pid
echo "Started pid $(cat server.pid) on http://${HOST}:${PORT}"
