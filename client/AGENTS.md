<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project contracts

Follow the repository-wide safety and runtime rules in [`../AGENTS.md`](../AGENTS.md).
Client behavior is specified in [`../docs/CLIENT_FLOW.md`](../docs/CLIENT_FLOW.md) and the HTTP/session contract in [`../docs/API.md`](../docs/API.md). Update the relevant code and these authoritative documents together.

## Client contribution and testing

- Follow the contribution workflow and testing matrix in [`../AGENTS.md`](../AGENTS.md).
- Before writing Next.js code, read the relevant local guide in `node_modules/next/dist/docs/` and follow its current conventions and deprecations.
- Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e` before handoff.
- Add regression coverage with verified RED before implementation. For UI changes, exercise real browser flow plus desktop/mobile responsiveness, accessibility, focus behavior, and required draft/session-state preservation.
