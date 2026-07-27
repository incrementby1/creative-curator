# Spatial Brand Workspace evidence

Production evidence was refreshed 2026-07-27 from base commit `dd8e276aa933b85e2450768cd149b3c3300b47a1` with Chromium, real Next.js and FastAPI test servers, test authentication, and in-memory persistence. The unchanged public landing and sign-in captures remain from the earlier public-surface evidence run; every authenticated production scenario was recaptured after legacy runtime removal. No remote Supabase or live provider was contacted.

## Capture verification

```text
cd client
npx playwright test e2e/task9-production-evidence.spec.ts --reporter=line
1 passed (6.0s)

npx playwright test e2e/task9-production-scenarios.spec.ts --reporter=line --workers=1
1 passed (10.2s)

npx playwright test e2e/constellation.spec.ts e2e/constellation-mobile.spec.ts -g "compact toolbar|mobile focus" --reporter=line
2 passed (6.9s)
```

Temporary capture support was removed after the runs. Screenshots are intentional review evidence, not Playwright `test-results` artifacts. Desktop and mobile constellation theme PNGs are viewport captures with exact image dimensions of 1440×1000 and 390×844. Scenario PNGs use those same browser viewports with full-page screenshots, so their image heights may exceed the viewport.

Across the three final browser commands, 4 tests passed, 0 failed, and 0 skipped.

The capture asserted the effective theme, opaque named surfaces, no horizontal overflow, no production link to `/studio` or `/projects/legacy/*`, a complete eight-control desktop dock, exactly one Undo/Redo pair, Select active, a keyboard-focused Select tooltip, and selected-node Inspector sections `Connect nodes` and `Size & position`. Mobile capture asserted automatic-layout focus workflow and absence of the desktop dock. No undeclared accessibility scanner was used.

Direct local image inspection covered all six theme captures and all 16 authenticated scenario replacements. Surfaces were opaque and tooltip/focus contrast was readable; inspection found no dock clipping, horizontal overflow, duplicate history arrows, legacy navigation, browser/test artifacts, or truncated focus workflow. Paper, Graphite, and Project each had zero capture assertion failures at both viewports.

## Evidence index

Ephemeral in-memory UUIDs replace `:projectId` in rendered routes.

| Scenario | Route | Theme | Desktop capture | Mobile capture |
| --- | --- | --- | --- | --- |
| Public landing | `/` | Public Clear Workbench | [1440×1000 viewport, full page](00-public-landing-desktop-1440.png) | [390×844 viewport, full page](00-public-landing-mobile-390.png) |
| Sign-in | `/login` | Public Clear Workbench | [1440×1000 viewport, full page](01-landing-login-desktop-1440.png) | [390×844 viewport, full page](01-landing-login-mobile-390.png) |
| Projects | `/projects` | Authenticated Clear Workbench | [1440×1000 viewport, full page](02-projects-desktop-1440.png) | [390×844 viewport, full page](02-projects-mobile-390.png) |
| Adaptive diagnostic | `/projects/new` | Authenticated Clear Workbench | [1440×1000 viewport, full page](03-diagnostic-desktop-1440.png) | [390×844 viewport, full page](03-diagnostic-mobile-390.png) |
| Selected-node compact dock / mobile focus workflow | `/projects/:projectId` | Paper | [1440×1000 viewport PNG](04-constellation-paper-desktop-1440.png) | [390×844 viewport PNG](04-constellation-paper-mobile-390.png) |
| Selected-node compact dock / mobile focus workflow | `/projects/:projectId` | Graphite | [1440×1000 viewport PNG](04-constellation-graphite-desktop-1440.png) | [390×844 viewport PNG](04-constellation-graphite-mobile-390.png) |
| Selected-node compact dock / mobile focus workflow | `/projects/:projectId` | Project | [1440×1000 viewport PNG](04-constellation-project-desktop-1440.png) | [390×844 viewport PNG](04-constellation-project-mobile-390.png) |
| Annotation and private media | `/projects/:projectId` | Paper | [1440×1000 viewport, full page](05-annotation-media-desktop-1440.png) | [390×844 viewport, full page](05-annotation-media-mobile-390.png) |
| Hermes proposal preview | `/projects/:projectId` | Paper | [1440×1000 viewport, full page](06-hermes-proposal-preview-desktop-1440.png) | [390×844 viewport, full page](06-hermes-proposal-preview-mobile-390.png) |
| Accepted Hermes challenge | `/projects/:projectId` | Paper | [1440×1000 viewport, full page](07-hermes-challenge-desktop-1440.png) | [390×844 viewport, full page](07-hermes-challenge-mobile-390.png) |
| Starter Brand Blueprint | `/projects/:projectId/blueprint` | Paper | [1440×1000 viewport, full page](08-blueprint-desktop-1440.png) | [390×844 viewport, full page](08-blueprint-mobile-390.png) |
| Provider settings | `/settings` | Authenticated Clear Workbench | [1440×1000 viewport, full page](09-settings-desktop-1440.png) | [390×844 viewport, full page](09-settings-mobile-390.png) |
| Reduced-motion constellation | `/projects/:projectId` | Paper, reduced motion | [1440×1000 viewport, full page](10-reduced-motion-desktop-1440.png) | [390×844 viewport, full page](10-reduced-motion-mobile-390.png) |

Provider evidence exposes only deterministic test metadata and masked key suffix `4F2A`; no credential or user token appears in any image.
