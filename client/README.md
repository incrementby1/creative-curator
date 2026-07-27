# Creative Curator client

Next.js 16 interface for the Creative Curator Brand Constellation workspace. See the
repository-level `README.md` for setup and verification commands.

The browser calls authenticated `/api/projects/*`, `/api/settings/*`, and
`/api/users/*` routes; Next.js proxies them to server-only `BACKEND_URL`.
Copy `.env.example` to `.env.local` only when backend is not running at default
`http://127.0.0.1:8000`.
