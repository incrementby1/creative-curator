## Summary

-

## Why

-

## Scope

- Included:
- Excluded:

## Authoritative documentation

- [ ] Owning documentation was updated with the implementation.
- [ ] No documentation change is needed. Reason:

## Verification

List exact commands, pass counts, skips, and failures.

- [ ] Backend: `cd backend && python -m unittest discover -s tests -v`
- [ ] Client lint: `cd client && npm run lint`
- [ ] Client types: `cd client && npx tsc --noEmit`
- [ ] Client build: `cd client && npm run build`
- [ ] Client E2E: `cd client && npm run test:e2e`
- [ ] Other focused checks:

## Safety

- [ ] No secrets, generated environment files, build output, or test artifacts are included.
- [ ] No remote Supabase or live-provider operation ran.
- [ ] Persistence changes, if any, were tested only against in-memory or proven-local services.

## UI evidence

- [ ] Not applicable.
- [ ] Desktop and mobile behavior verified; screenshots or recordings attached.
- [ ] Accessibility, focus, reduced motion, drafts, and session state were checked where applicable.

## Reviewer notes

- Risks, follow-ups, or intentionally deferred work:
