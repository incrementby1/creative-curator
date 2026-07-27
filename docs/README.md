# Creative Curator documentation

Authoritative implementation contracts; update owning document with behavior.

| Document | Ownership |
| --- | --- |
| [`../PRODUCT.md`](../PRODUCT.md) | audience, purpose, product rules, omissions |
| [`../DESIGN.md`](../DESIGN.md) | workbench, themes, graph interaction, accessibility, motion |
| [`CLIENT_FLOW.md`](CLIENT_FLOW.md) | project, Constellation, recovery, and Blueprint behavior |
| [`API.md`](API.md) | authenticated HTTP, version, proposal, cache, snapshot contracts |
| [`SUPABASE.md`](SUPABASE.md) | local schema, migrations, rollback, safety |
| [`../README.md`](../README.md) | setup and mandatory verification |
| [`DEVLOG.md`](DEVLOG.md) | concise project history |
| [`CHANGELOG.md`](CHANGELOG.md) | release-facing product changes |
| [`INDEX.md`](INDEX.md) | current contracts and approved design/plan inputs |
| [`DEMO_TUTORIAL.md`](DEMO_TUTORIAL.md) | local Brand Constellation walkthrough |
| [`COMPONENT_PROVENANCE.md`](COMPONENT_PROVENANCE.md) | adapted component provenance and rejections |

Brand Constellation is the sole production journey at `/projects/{projectId}`, entered through `/projects` and adaptive `/projects/new`. Interactive and printable Blueprint lives at `/projects/{projectId}/blueprint`; provider routing lives at `/settings`. Removed product URLs use normal Not Found behavior and expose no compatibility surface.

Current production-workspace behavior follows approved [design](superpowers/specs/2026-07-27-production-workspace-toolbar-design.md) and [implementation plan](superpowers/plans/2026-07-27-production-workspace-toolbar-implementation.md). They supersede active runtime and toolbar clauses in dated 2026-07-26 records without rewriting that history.
