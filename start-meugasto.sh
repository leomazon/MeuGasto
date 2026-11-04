#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=8000
URL="http://127.0.0.1:${PORT}"
LOG_FILE="/tmp/meugasto-server.log"

if ! curl -fsS "$URL" 2>/dev/null | grep -q '<title>MeuGasto</title>'; then
  nohup /usr/bin/python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$APP_DIR" >"$LOG_FILE" 2>&1 </dev/null &
  ready=0
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if curl -fsS "$URL" 2>/dev/null | grep -q '<title>MeuGasto</title>'; then
      ready=1
      break
    fi
    attempt=$((attempt + 1))
    sleep 0.25
  done
  if [ "$ready" -ne 1 ]; then
    if command -v zenity >/dev/null 2>&1; then
      zenity --error --title="MeuGasto" --text="Não foi possível iniciar o app. Confira se a porta 8000 está livre."
    fi
    exit 1
  fi
fi

exec /usr/bin/xdg-open "$URL"
