#!/usr/bin/env python3
"""Serve MeuGasto on loopback and persist its single-user state in SQLite."""

import argparse
import json
import sqlite3
import threading
import time
import re
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


APP_DIR = Path(__file__).resolve().parent
MAX_STATE_BYTES = 5 * 1024 * 1024


class StateStore:
    def __init__(self, database_path, backup_interval_seconds=1800, retention=30):
        self.lock = threading.RLock()
        self.backup_interval_seconds = backup_interval_seconds
        self.retention = max(2, retention)
        self.path = Path(database_path).expanduser().resolve()
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

        if self.load_state() is not None:
            self._maybe_backup()

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
        if "budgets" in state and not isinstance(state["budgets"], list):
            raise ValueError("Invalid budgets")
        with self.lock:
            self._write_state(state)
            self._maybe_backup()

    def _write_state(self, state):
        serialized = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO app_state (id, state_json, updated_at) "
                "VALUES (1, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET "
                "state_json = excluded.state_json, updated_at = excluded.updated_at",
                (serialized,),
            )

    @property
    def backup_dir(self):
        path = self.path.parent / "backups"
        path.mkdir(mode=0o700, exist_ok=True)
        path.chmod(0o700)
        return path

    def list_backups(self):
        with self.lock:
            files = sorted(self.backup_dir.glob("backup-*.sqlite3"), key=lambda p: p.stat().st_mtime_ns, reverse=True)
            return [{"name": p.name, "createdAt": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(), "size": p.stat().st_size} for p in files]

    def _maybe_backup(self):
        files = self.list_backups()
        if not files or time.time() - (self.backup_dir / files[0]["name"]).stat().st_mtime >= self.backup_interval_seconds:
            self.create_backup()

    def create_backup(self):
        with self.lock:
            if self.load_state() is None:
                raise ValueError("Ainda não há dados para copiar")
            name = "backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid.uuid4().hex[:8] + ".sqlite3"
            target = self.backup_dir / name
            source = self._connect()
            destination = sqlite3.connect(target)
            try:
                source.backup(destination)
            finally:
                destination.close()
                source.close()
            target.chmod(0o600)
            for item in self.list_backups()[self.retention:]:
                (self.backup_dir / item["name"]).unlink()
            return name

    def read_backup(self, name):
        if not isinstance(name, str) or not re.fullmatch(r"backup-[A-Za-z0-9-]+\.sqlite3", name):
            raise ValueError("Cópia inválida")
        path = self.backup_dir / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Cópia não encontrada")
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        try:
            row = connection.execute("SELECT state_json FROM app_state WHERE id=1").fetchone()
            state = json.loads(row[0]) if row else None
            if not isinstance(state, dict) or any(not isinstance(state.get(key), list) for key in ("expenses", "cards", "settlements")):
                raise ValueError("Cópia inválida")
            if "budgets" in state and not isinstance(state["budgets"], list):
                raise ValueError("Cópia inválida")
            return state
        finally:
            connection.close()

    def restore_backup(self, name):
        with self.lock:
            state = self.read_backup(name)
            self.create_backup()
            self._write_state(state)



def make_handler(store):
    class MeuGastoHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(APP_DIR), **kwargs)

        def do_GET(self):
            if urlsplit(self.path).path == "/api/backups":
                self._json_response(200, {"backups": store.list_backups()})
                return
            if urlsplit(self.path).path != "/api/state":
                return super().do_GET()
            state = store.load_state()
            self._json_response(200, {"initialized": state is not None, "state": state, "apiVersion": 2})

        def do_POST(self):
            path = urlsplit(self.path).path
            try:
                if path == "/api/backups":
                    store.create_backup()
                elif path == "/api/backups/restore":
                    size = int(self.headers.get("Content-Length", "0"))
                    if size < 1 or size > MAX_STATE_BYTES:
                        raise ValueError("Pedido inválido")
                    payload = json.loads(self.rfile.read(size))
                    if not isinstance(payload, dict):
                        raise ValueError("Pedido inválido")
                    store.restore_backup(payload.get("name"))
                else:
                    self._json_response(404, {"error": "not found"})
                    return
                self._json_response(200, {"ok": True})
            except (ValueError, sqlite3.Error, OSError):
                self._json_response(400, {"error": "Não foi possível acessar a cópia local."})

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
