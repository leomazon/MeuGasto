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


if __name__ == "__main__":
    unittest.main()
