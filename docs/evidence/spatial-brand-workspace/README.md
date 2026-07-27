# Spatial Brand Workspace evidence

Production evidence was corrected 2026-07-27 from base commit `d054148` with Chromium, real Next.js and FastAPI test servers, test authentication, and in-memory persistence. Four rejected desktop captures were replaced after final dock and proposal-layout review; remaining captures are unchanged. No remote Supabase or live provider was contacted.

## Capture verification

```text
cd client
npx playwright test e2e/task9-evidence-correction.spec.ts --reporter=line --workers=1
1 passed, 1 failed (12.0s; rejected wrong deterministic proposal-text expectation before screenshot)

npx playwright test e2e/task9-evidence-correction.spec.ts -g "recapture settled Hermes proposal" --reporter=line --workers=1
1 passed (5.8s)

npx playwright test e2e/task9-evidence-correction.spec.ts -g "recapture selected-node desktop themes" --reporter=line --workers=1
1 passed (4.0s)
```

Temporary capture support was removed after the runs. Screenshots are intentional review evidence, not Playwright `test-results` artifacts. Desktop and mobile constellation theme PNGs are viewport captures with exact image dimensions of 1440×1000 and 390×844. The corrected desktop Hermes proposal is also an exact 1440×1000 viewport capture; other scenario PNGs use the documented browser viewports with full-page screenshots, so their image heights may exceed the viewport.

Across the correction commands, 3 tests passed, 1 initial assertion failed before screenshot, and 0 skipped. Capture-only initialization removed the Next.js development portal and asserted zero portal elements immediately before every screenshot. Final captures asserted settled persistence after final viewport and scroll changes.

The correction capture asserted effective theme, selected node, a complete eight-control desktop dock within viewport margins, exactly one Undo/Redo pair, Select active, a keyboard-focused Select tooltip, and visible Inspector sections `Connect nodes` and `Size & position`. Proposal capture additionally asserted settled layout, complete readable content, and zero overlap with semantic nodes, work panel, minimap, dock, and viewport controls. No undeclared accessibility scanner was used.

Direct local image inspection covered all four corrected desktop captures. The proposal remained fully readable inside the exact 1440×1000 canvas without node, work-panel, minimap, dock, or controls overlap. All themes visibly show selected-node Inspector connection controls and the `Size & position` section heading, one complete eight-control dock, one Undo/Redo pair, active Select, and its keyboard-focus tooltip. Inspection found no dock clipping, legacy navigation, development portal, or transient save text.

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
| Hermes proposal preview | `/projects/:projectId` | Paper | [1440×1000 viewport PNG](06-hermes-proposal-preview-desktop-1440.png) | [390×844 viewport, full page](06-hermes-proposal-preview-mobile-390.png) |
| Accepted Hermes challenge | `/projects/:projectId` | Paper | [1440×1000 viewport, full page](07-hermes-challenge-desktop-1440.png) | [390×844 viewport, full page](07-hermes-challenge-mobile-390.png) |
| Starter Brand Blueprint | `/projects/:projectId/blueprint` | Paper | [1440×1000 viewport, full page](08-blueprint-desktop-1440.png) | [390×844 viewport, full page](08-blueprint-mobile-390.png) |
| Provider settings | `/settings` | Authenticated Clear Workbench | [1440×1000 viewport, full page](09-settings-desktop-1440.png) | [390×844 viewport, full page](09-settings-mobile-390.png) |
| Reduced-motion constellation | `/projects/:projectId` | Paper, reduced motion | [1440×1000 viewport, full page](10-reduced-motion-desktop-1440.png) | [390×844 viewport, full page](10-reduced-motion-mobile-390.png) |

Provider evidence exposes only deterministic test metadata and masked key suffix `4F2A`; no credential or user token appears in any image.
