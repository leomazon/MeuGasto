#!/usr/bin/env python3
"""Serve MeuGasto on loopback and persist its single-user state in SQLite."""

import argparse
import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


APP_DIR = Path(__file__).resolve().parent
MAX_STATE_BYTES = 5 * 1024 * 1024


class StateStore:
    def __init__(self, database_path):
        self.path = Path(database_path).expanduser()
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            self.path.parent.chmod(0o700)
        except OSError:
            pass
        with self._connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS app_state ("
                "id INTEGER PRIMARY KEY CHECK (id = 1), "
                "state_json TEXT NOT NULL, "
                "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def load_state(self):
        with self._connect() as connection:
            row = connection.execute("SELECT state_json FROM app_state WHERE id = 1").fetchone()
        return json.loads(row["state_json"]) if row else None

    def save_state(self, state):
        if not isinstance(state, dict) or any(
            not isinstance(state.get(key), list)
            for key in ("expenses", "cards", "settlements")
        ):
            raise ValueError("State must contain expense, card, and settlement lists")
        serialized = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO app_state (id, state_json, updated_at) "
                "VALUES (1, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET "
                "state_json = excluded.state_json, updated_at = excluded.updated_at",
                (serialized,),
            )


def make_handler(store):
    class MeuGastoHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(APP_DIR), **kwargs)

        def do_GET(self):
            if urlsplit(self.path).path != "/api/state":
                return super().do_GET()
            state = store.load_state()
            self._json_response(200, {"initialized": state is not None, "state": state})

        def do_PUT(self):
            if urlsplit(self.path).path != "/api/state":
                self._json_response(404, {"error": "not found"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > MAX_STATE_BYTES:
                    raise ValueError("Invalid request size")
                state = json.loads(self.rfile.read(size))
                store.save_state(state)
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(400, {"error": str(error)})
                return
            self._json_response(200, {"saved": True})

        def _json_response(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format_string, *args):
            if not self.path.startswith("/api/"):
                super().log_message(format_string, *args)

    return MeuGastoHandler


def main():
    parser = argparse.ArgumentParser(description="Run the local MeuGasto app and SQLite storage")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    data_dir = args.data_dir or Path.home() / ".local" / "share" / "meugasto"
    store = StateStore(data_dir / "meugasto.sqlite3")
    server = ThreadingHTTPServer((args.bind, args.port), make_handler(store))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
