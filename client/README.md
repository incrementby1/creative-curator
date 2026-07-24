# Creative Curator client

Next.js 16 interface for the Creative Curator direction workflow. See the
repository-level `README.md` for setup and verification commands.

The browser calls `/api/creative/*`; Next.js proxies those requests to the
server-only `BACKEND_URL`. Copy `.env.example` to `.env.local` only when the
backend is not running at the default `http://127.0.0.1:8000`.
