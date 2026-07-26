# Spatial Brand Workspace evidence

Captured 2026-07-27 from commit `0872113346f6bd946c331c01be8325cdaa1a8a38` with Chromium, real Next.js and FastAPI test servers, `InMemorySessionStore`, test authentication, and deterministic test-provider transport. No remote Supabase or live provider was contacted.

## Capture verification

```text
cd client
npx playwright test e2e/task20-evidence.spec.ts --reporter=line
1 passed (6.4s)

npx playwright test e2e/task20-landing-evidence.spec.ts --reporter=line
1 passed (1.8s)
```

Temporary capture spec was removed after the run. Screenshots are intentional review evidence, not Playwright `test-results` artifacts.

Each capture asserted a visible document and no horizontal viewport overflow at 1440×1000 and 390×844. Theme captures additionally asserted the effective `data-theme`; reduced-motion capture asserted node transition duration was disabled. Existing project E2E coverage owns keyboard focus order, 44px mobile targets, semantic announcements, and theme geometry parity. No undeclared accessibility scanner was used.

Accessibility assertion failures by theme:

| Theme | Desktop 1440 | Mobile 390 |
| --- | ---: | ---: |
| Paper | 0 | 0 |
| Graphite | 0 | 0 |
| Project | 0 | 0 |

## Evidence index

| Scenario | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Public landing | [PNG](00-public-landing-desktop-1440.png) | [PNG](00-public-landing-mobile-390.png) |
| Sign-in | [PNG](01-landing-login-desktop-1440.png) | [PNG](01-landing-login-mobile-390.png) |
| Projects | [PNG](02-projects-desktop-1440.png) | [PNG](02-projects-mobile-390.png) |
| Adaptive diagnostic | [PNG](03-diagnostic-desktop-1440.png) | [PNG](03-diagnostic-mobile-390.png) |
| Representative constellation — Paper | [PNG](04-constellation-paper-desktop-1440.png) | [PNG](04-constellation-paper-mobile-390.png) |
| Representative constellation — Graphite | [PNG](04-constellation-graphite-desktop-1440.png) | [PNG](04-constellation-graphite-mobile-390.png) |
| Representative constellation — Project | [PNG](04-constellation-project-desktop-1440.png) | [PNG](04-constellation-project-mobile-390.png) |
| Annotation and private media | [PNG](05-annotation-media-desktop-1440.png) | [PNG](05-annotation-media-mobile-390.png) |
| Hermes proposal preview | [PNG](06-hermes-proposal-preview-desktop-1440.png) | [PNG](06-hermes-proposal-preview-mobile-390.png) |
| Accepted Hermes challenge | [PNG](07-hermes-challenge-desktop-1440.png) | [PNG](07-hermes-challenge-mobile-390.png) |
| Starter Brand Blueprint | [PNG](08-blueprint-desktop-1440.png) | [PNG](08-blueprint-mobile-390.png) |
| Provider settings | [PNG](09-settings-desktop-1440.png) | [PNG](09-settings-mobile-390.png) |
| Reduced motion | [PNG](10-reduced-motion-desktop-1440.png) | [PNG](10-reduced-motion-mobile-390.png) |
| Read-only legacy session | [PNG](11-legacy-read-only-desktop-1440.png) | [PNG](11-legacy-read-only-mobile-390.png) |

Provider evidence exposes only deterministic test metadata and masked key suffix `4F2A`; no credential or user token appears in any image.
