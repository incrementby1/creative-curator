# Component provenance

## Spatial workbench adaptation

Internal reference: `origin/ui-updates` commit `774011b`, reviewed 2026-07-27. No file was copied wholesale. Current components were rebuilt against typed project state, owner-scoped APIs, semantic tokens, accessible labels, and isolated annotation/media persistence.

| Pattern | Reference | Adaptation decision |
| --- | --- | --- |
| shell | Compact work surface and content-first header | Adapted as stable three-region constellation geometry. |
| panel | Opaque bordered edit and Hermes regions | Adapted through semantic `WorkbenchPanel`; no persistent decorative shadow. |
| toolbar | Floating canvas tools with grouped actions | Adapted with text/accessibility names, 44px targets, keyboard/touch equivalents. |
| node | Note/root/sticky document-card language | Adapted into typed semantic nodes; lifecycle and type remain text. |
| resizer | React Flow `NodeResizer` handles | Adapted with focus visibility and enlarged target. |
| chat panel | Docked assistant work area | Adapted into proposal/challenge review; Hermes cannot silently mutate graph state. |
| freehand | `perfect-freehand` path generation with viewport transform | Adapted into separately persisted annotations, excluded from Hermes and Blueprint readiness. |

Rejected prototype hazards: **monolithic local state**, **hard-coded colors**, **base64 image storage**, **canvas-reset remount**, **unlabeled icon-only controls**, and **undeclared dependencies**. React Flow owns drag/resize; pointer handling owns drawing. Theme changes never remount canvas.

## External candidates

No 21st.dev candidate was needed or copied for Task 14. Therefore no external author, license, URL, copied file, or added dependency applies. Any future candidate requires provenance review before code enters repository.
