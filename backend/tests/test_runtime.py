import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


class RuntimeTests(unittest.TestCase):
    def test_declared_runtime_is_python_311_or_newer(self) -> None:
        declared_version = (BACKEND_DIR / ".python-version").read_text().strip()

        self.assertTrue(declared_version.startswith("3.11"))
        self.assertGreaterEqual(sys.version_info, (3, 11))


if __name__ == "__main__":
    unittest.main()
