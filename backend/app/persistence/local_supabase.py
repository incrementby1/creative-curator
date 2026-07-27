from urllib.parse import urlparse


def require_local_supabase_url(url: str) -> None:
    if urlparse(url).hostname not in {"localhost", "127.0.0.1"}:
        raise RuntimeError(
            "Local Supabase tests may only target localhost or 127.0.0.1."
        )
