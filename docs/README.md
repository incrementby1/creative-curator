# Creative Curator documentation

Authoritative implementation contracts; update owning document with behavior.

| Document | Ownership |
| --- | --- |
| [`../PRODUCT.md`](../PRODUCT.md) | audience, purpose, product rules, omissions |
| [`../DESIGN.md`](../DESIGN.md) | workbench, themes, graph interaction, accessibility, motion |
| [`CLIENT_FLOW.md`](CLIENT_FLOW.md) | project, constellation, recovery, legacy, and Blueprint behavior |
| [`API.md`](API.md) | authenticated HTTP, version, proposal, cache, snapshot contracts |
| [`SUPABASE.md`](SUPABASE.md) | local schema, migrations, rollback, safety |
| [`../README.md`](../README.md) | setup and mandatory verification |
| [`DEVLOG.md`](DEVLOG.md) | concise project history |
| [`COMPONENT_PROVENANCE.md`](COMPONENT_PROVENANCE.md) | adapted component provenance and rejections |

Primary product: Brand Constellation at `/projects/{projectId}`, entered through `/projects` and adaptive `/projects/new`. Interactive and printable Blueprint lives at `/projects/{projectId}/blueprint`. Earlier fixed Guided Workspace sessions are historical, owner-scoped, read-only legacy content; they are not primary and are never inferred into graph state.

[`DEMO_TUTORIAL.md`](DEMO_TUTORIAL.md) documents legacy Guided Workspace behavior only.
