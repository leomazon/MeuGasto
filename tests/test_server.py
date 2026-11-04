import os
import stat
import tempfile
import unittest
from pathlib import Path

from server import StateStore


class StateStoreTests(unittest.TestCase):
    def test_state_is_saved_to_sqlite_and_survives_reopening_the_store(self):
        state = {
            "expenses": [{"id": "rent", "amount": 1450.75}],
            "cards": [{"id": "card", "limit": 3000}],
            "settlements": [{"id": "payment", "amount": 100}],
        }
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "meugasto.sqlite3"
            first = StateStore(path)
            self.assertIsNone(first.load_state())
            first.save_state(state)

            second = StateStore(path)
            self.assertEqual(second.load_state(), state)
            self.assertTrue(path.is_file())
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_rejects_invalid_state_without_overwriting_saved_data(self):
        state = {"expenses": [], "cards": [], "settlements": []}
        with tempfile.TemporaryDirectory() as folder:
            store = StateStore(Path(folder) / "meugasto.sqlite3")
            store.save_state(state)
            with self.assertRaises(ValueError):
                store.save_state({"expenses": "private-data"})
            self.assertEqual(store.load_state(), state)

    def test_automatic_backups_restore_data_and_keep_a_safety_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            store = StateStore(Path(folder) / "meugasto.sqlite3", backup_interval_seconds=0, retention=5)
            first = {"expenses": [{"id": "first"}], "cards": [], "settlements": [], "budgets": [{"category": "Contas", "amount": 100}]}
            store.save_state(first)
            backup = store.list_backups()[0]["name"]
            second = {"expenses": [{"id": "second"}], "cards": [], "settlements": []}
            store.save_state(second)
            store.restore_backup(backup)
            self.assertEqual(store.load_state(), first)
            self.assertGreaterEqual(len(store.list_backups()), 3)
            self.assertTrue(any(store.read_backup(item["name"]) == second for item in store.list_backups()))
            with self.assertRaises(ValueError):
                store.restore_backup("../meugasto.sqlite3")
            self.assertEqual(store.load_state(), first)

    def test_backup_retention_and_invalid_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            store = StateStore(Path(folder) / "meugasto.sqlite3", backup_interval_seconds=0, retention=2)
            for number in range(4):
                store.save_state({"expenses": [{"id": str(number)}], "cards": [], "settlements": []})
            self.assertEqual(len(store.list_backups()), 2)
            saved = store.load_state()
            with self.assertRaises(ValueError):
                store.restore_backup("backup-missing.sqlite3")
            self.assertEqual(store.load_state(), saved)


if __name__ == "__main__":
    unittest.main()
