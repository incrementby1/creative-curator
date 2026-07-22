import sys
import inspect
import unittest
from pathlib import Path

import httpcore
import httpx


BACKEND_DIR = Path(__file__).resolve().parents[1]


class RuntimeTests(unittest.TestCase):
    def test_declared_runtime_is_python_311_or_newer(self) -> None:
        declared_version = (BACKEND_DIR / ".python-version").read_text().strip()

        self.assertTrue(declared_version.startswith("3.11"))
        self.assertGreaterEqual(sys.version_info, (3, 11))

    def test_security_sensitive_http_stack_is_exactly_pinned_and_supports_sni_extension(self) -> None:
        requirements = (BACKEND_DIR / "requirements.txt").read_text().splitlines()
        self.assertIn("httpx==0.28.1", requirements)
        self.assertIn("httpcore==1.0.9", requirements)
        self.assertEqual(httpx.__version__, "0.28.1")
        self.assertEqual(httpcore.__version__, "1.0.9")
        self.assertIn("extensions", inspect.signature(httpx.Client.stream).parameters)
        httpx_boundary = inspect.getsource(httpx.HTTPTransport.handle_request)
        self.assertIn("extensions=request.extensions", httpx_boundary)
        httpcore_boundary = inspect.getsource(httpcore.HTTPConnection._connect)
        self.assertIn('request.extensions.get("sni_hostname", None)', httpcore_boundary)
        self.assertIn('"server_hostname": sni_hostname', httpcore_boundary)


if __name__ == "__main__":
    unittest.main()
