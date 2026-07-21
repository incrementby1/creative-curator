# Creative Curator project contract

Keep implementation and its authoritative documentation in sync in the same change.

| Document | Ownership |
| --- | --- |
| `docs/CLIENT_FLOW.md` | Product and client behavior |
| `docs/API.md` | HTTP and session-state contract |
| `docs/SUPABASE.md` | Local persistence workflow |
| `README.md` | Setup and verification |
| `docs/DEVLOG.md` | Project history |

## Runtime

- The backend requires Python 3.11 or newer.
- Follow `client/AGENTS.md` for Next.js work.

## Supabase safety

- Development uses Supabase locally only.
- Never run `supabase link`, `supabase db push`, linked migrations, or any remote mutation without explicit user approval.
- Persistence tests may use only in-memory stores or a URL proven to target `localhost` or `127.0.0.1`.
