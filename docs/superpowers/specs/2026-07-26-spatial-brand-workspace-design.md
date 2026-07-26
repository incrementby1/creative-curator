# Spatial Brand Workspace Design

**Status:** Approved design for implementation planning  
**Date:** 2026-07-26  
**Branch:** `codex/spatial-brand-workspace-design`  
**Scope:** MVP brand creation from scratch

## 1. Product decision

Creative Curator will evolve from a fixed campaign-review sequence into a spatial brand-development system. The current sequence—brief, Brand DNA, three directions, two rejections, refinement, approval, and artifact—assumes the user already has a named brand and a clear brief. It remains useful as a later campaign capability, but it is not the core journey for someone building a brand from nothing.

The redesigned product helps a solo brand owner turn scattered ideas into a coherent, defensible Starter Brand Blueprint. Hermes acts as an active creative director: it identifies unsupported assumptions, contradictions, psychological implications, cultural considerations, and downstream consequences. It proposes changes but never silently alters the brand's source of truth.

The MVP promise is:

> Turn scattered ideas into a coherent, defensible Starter Brand Blueprint.

The broader product direction is:

> A spatial thinking partner that helps a person understand, construct, test, and express a brand.

## 2. Audience and project model

Creative Curator ultimately supports both new and existing brands. The MVP focuses on **building a brand from scratch**. Campaign creation and existing-brand development will become later project branches that reuse the same brand graph.

The product journey is:

1. Landing page
2. Sign up or sign in
3. Projects page
4. Create project
5. Short adaptive diagnostic
6. Brand Constellation workspace
7. Interactive Starter Brand Blueprint
8. Versioned PDF snapshot

The diagnostic asks what the user knows, what they are trying to build, available evidence, constraints, desired outcomes, and open questions. It seeds the graph without prescribing a sequence. It recommends an initial area to explore while allowing the user to work anywhere.

## 3. Non-linear brand development

Brand creation is iterative. Audience learning can change positioning; positioning can invalidate naming; visual exploration can expose a weak personality; a promising name can reshape the concept. The product must guide without becoming a wizard.

The Brand Constellation is the project home. Users can:

- capture thoughts directly;
- connect ideas spatially;
- enter guided exploration with Hermes;
- compare competing branches;
- accept, revise, defer, or override challenges;
- approve working decisions;
- generate optional outputs when relevant areas are ready; and
- revisit any decision when the brand evolves.

Nothing is permanently locked. Foundational changes mark dependent work as **review suggested** instead of erasing it. The project remains alive after its first Blueprint and becomes the brand's source of truth.

## 4. Graph model

The graph is structured enough for reliable reasoning without imposing a fixed order.

### 4.1 Node types

- **Evidence:** user-supplied observation, source, constraint, or fact
- **Assumption:** unverified belief that may require research
- **Idea:** possible direction that is neither approved nor rejected
- **Decision:** explicit working or approved choice
- **Challenge:** Hermes or user objection linked to affected work
- **Output:** generated deliverable or Blueprint section

Every node records its project owner, lifecycle state, provenance, current version, creation source, and revision history. Generated content never masquerades as user evidence.

### 4.2 Relationship types

- **Supports**
- **Contradicts**
- **Depends on**
- **Inspires**
- **Supersedes**

Relationships are semantic application records, not merely drawn lines. Color alone never communicates relationship meaning.

### 4.3 Branching

Competing brand directions remain in named branches or frames until the user promotes one. A branch cannot silently become the approved brand direction. Superseded work remains available through history rather than disappearing.

## 5. Hermes behavior

Hermes is an active challenger rather than an agreeable chatbot. It can:

- detect contradictions between connected decisions;
- challenge unsupported assumptions;
- surface psychological and cultural implications;
- explain likely downstream consequences;
- distinguish evidence from hypotheses;
- mark work as unresolved, fragile, coherent, or ready;
- suggest experiments and alternative directions;
- recommend the next highest-value action;
- reopen affected work when a foundational decision changes; and
- respect explicit user overrides while preserving the recorded tradeoff.

Hermes suggestions live as proposals until accepted. A proposal can preview new nodes, edges, challenges, and readiness changes on the canvas, but it cannot mutate approved graph state on its own.

The challenge lifecycle is:

1. Open
2. Acknowledged
3. Resolved, deferred, or intentionally overridden

Each challenge includes its rationale, relevant dependencies, confidence, and likely downstream effect.

The MVP does not perform autonomous external research. Hermes reasons only from user-supplied material. When evidence is missing, it labels the gap, proposes research questions, and allows the user to add evidence or explicitly retain an assumption. External cited research is deferred.

## 6. Hermes context and analysis cache

The graph itself is structured application state and does not consume model tokens during navigation, arrangement, filtering, or selection. Hermes runs only after meaningful user actions or explicit review requests.

Each analysis receives:

- the selected node or project intent;
- relevant neighboring nodes and relationships;
- compact summaries for affected branches;
- applicable unresolved challenges; and
- the requested analysis type.

The backend must not serialize the full project graph into every request.

Analysis cache keys include:

- relevant node and edge versions;
- a deterministic subgraph-content hash;
- analysis type;
- provider and model;
- prompt version; and
- structured-output schema version.

Unchanged inputs reuse prior analysis without a provider call. A graph change invalidates only analyses whose dependency set includes changed records. Routine classification may use a less expensive routed model later, but model-tier policy is not required for the first implementation.

## 7. Workspace interaction

The workspace supports both direct creativity and guided help.

### 7.1 Quick capture

The user can immediately create a thought, evidence item, assumption, concern, idea, or decision. Hermes may propose a more suitable type or useful connections afterward. Quick capture must not require a model call.

### 7.2 Guided exploration

Selecting a node and choosing guided exploration opens a Hermes session scoped to that node and its relevant subgraph. Structured proposals appear in a review tray and preview on the canvas before acceptance.

### 7.3 Editing rules

- Hermes never silently approves, moves, or rearranges graph content.
- Semantic content and canvas placement save independently.
- Autosave exposes `Saving`, `Saved`, and `Needs attention` states.
- Undo and redo cover local graph interaction history.
- Durable revision history records meaningful server-side changes.
- Project trash retains deleted nodes for recovery before permanent deletion.
- Blueprint generation creates a snapshot without freezing the living graph.

## 8. Interface architecture

The application uses a quiet, adaptable workbench shell and infinite canvas, adapted for brand reasoning. Its interaction and visual baseline comes from the `ui-updates` prototype at commit `774011b`: compact neutral chrome, content-first typography, thin borders, restrained elevation, a docked Hermes panel, and lightweight canvas tools. The implementation may reuse those ideas, but it must rebuild them on the typed project-graph architecture rather than copy the prototype's local-state component wholesale.

### 8.1 Desktop shell

- Compact top toolbar with project identity, current mode, save state, theme selection, and export
- Collapsible left project-map panel for projects, clusters, branches, filtering, and unresolved work
- Central infinite Brand Constellation canvas
- Dockable right work panel that switches among precise node editing, relationships, history, and Hermes challenges
- Floating canvas toolbar for selection, connection, quick capture, annotations, and media
- Separate Blueprint mode for focused reading and export

The graph is the primary working surface rather than a decorative navigator.

### 8.2 Graph foundation

Use `@xyflow/react` (React Flow) for graph mechanics: viewport transforms, pan, zoom, selection, connection creation, resizing, keyboard operation, focus management, and minimap behavior.

Creative Curator owns all visible nodes, edges, toolbars, panels, graph semantics, state management, and styling. React Flow is interaction infrastructure, not the product's visual identity. The `ui-updates` prototype's note, image, root, sticky-note, resize, connection, and freehand interactions are references for interaction feel only.

Freehand marks and decorative images belong to a separate annotation layer. They persist independently from semantic nodes and edges, participate in their own undo history, and can never become evidence or approved decisions without an explicit user action.

Do not build a custom graph engine for the MVP.

### 8.3 Mobile

Mobile uses a focused graph navigator rather than shrinking the desktop editor:

- constellation overview and minimap;
- cluster or node focus mode;
- next and previous relationship traversal;
- quick capture and guided exploration;
- node creation, editing, connection, challenge, and approval;
- Blueprint reading and generation; and
- automatic layout instead of precision freeform positioning.

The complete brand-development journey remains available on mobile. Precision canvas arrangement is desktop-only.

## 9. Visual system

The approved direction is a versatile, content-first workbench inspired by the restraint of tools such as Notion and by the concrete `ui-updates` prototype. The interface should feel calm enough for long reasoning sessions and flexible enough for brands with very different personalities.

The system uses:

- warm neutral surfaces and charcoal text in the default theme;
- compact editor chrome and generous content space;
- strong typographic hierarchy instead of ornamental containers;
- thin borders, restrained shadows, and modest corner radii;
- color primarily for selection, status, semantic relationships, and user content;
- custom graph nodes that feel like editable documents, notes, and evidence cards; and
- persistent, readable inspector, Hermes, and Blueprint surfaces.

Glassmorphism, luminous bloom, skewed gradient backplates, decorative refraction, and an always-dark canvas are removed from the product direction.

### 9.1 Theme behavior

The MVP ships three token-driven themes with identical component geometry and behavior:

- **Paper:** the default warm-white workbench derived from `ui-updates`;
- **Graphite:** a restrained dark counterpart with opaque neutral surfaces rather than glass; and
- **Project:** neutral platform chrome with carefully bounded accents derived from the project's approved brand palette.

Users choose a global default and may override it per project. Project overrides persist with project preferences, while the global choice remains a user setting. Theme changes affect semantic tokens only; they cannot alter information hierarchy, hide status, or make project colors indistinguishable from selection, errors, warnings, or Hermes challenges.

Before a project has an approved accessible palette, Project falls back to Paper. Unsafe project colors are adjusted only for interface presentation and never rewrite the brand decision itself.

### 9.2 Motion and interaction rules

- Motion communicates selection, focus, node creation, graph changes, proposal previews, and panel transitions.
- Avoid perpetual motion, layout-shifting hover effects, decorative animation loops, and simulated depth that obscures content.
- Reduced-motion mode removes nonessential traversal and presence animation.
- Canvas dragging, drawing, resizing, and viewport movement remain under React Flow or direct pointer handling, not Motion.
- Every hover affordance has a visible focus and touch equivalent.
- All themes maintain WCAG 2.2 AA contrast for platform content and controls.

Use Motion for React only for purposeful layout, presence, and proposal transitions. CSS transitions are sufficient for simple color and focus changes.

## 10. Component sourcing

The client already uses TypeScript, React, Next.js, and Tailwind CSS 4. It does not yet have a shadcn configuration.

Implementation will:

- add a shadcn-compatible `components.json`, import aliases, local `components/ui` convention, and shared class utility;
- extract reusable shell, panel, toolbar, form, and graph-node patterns from the `ui-updates` prototype without copying its monolithic state management;
- source candidate interaction components from 21st.dev only where they materially improve accessibility or delivery speed;
- copy source into the repository rather than depend on the registry at runtime;
- adapt each imported component to Creative Curator tokens and behaviors; and
- record the source URL, author, license, dependencies, modifications, and usage for every imported component.

No prototype or 21st.dev component is accepted merely because it matches the visual style. Every candidate receives accessibility, responsive, performance, provenance, dependency, and license review. Hover-only behavior, unstable layout shifts, unbounded visual effects, and inaccessible contrast must be removed or redesigned.

## 11. MVP output

The single MVP deliverable is the **Starter Brand Blueprint**.

It contains:

- brand idea and purpose;
- target audience and central tension;
- positioning and differentiation;
- brand promise;
- personality and voice;
- naming territory and shortlisted names;
- messaging pillars and sample tagline;
- visual direction, including palette, typography, imagery, and logo brief;
- supporting evidence and explicit assumptions;
- unresolved Hermes challenges; and
- recommended next actions.

Finished logos, full asset libraries, landing pages, and campaigns are deferred optional modules.

### 11.1 Output formats

The canonical output is an interactive, responsive in-app Blueprint. Each section can reveal its rationale, source nodes, evidence, assumptions, and challenges.

The portable output is a dated, versioned PDF snapshot. The Blueprint uses one print-friendly HTML rendering model so the application and PDF do not diverge. Slides, DOCX, public share links, and editable design-file exports are deferred.

Users may request a Blueprint before every section is ready, but the export must state unresolved assumptions and readiness warnings.

## 12. Client routes

- `/` — public landing page
- `/login` — sign in and sign up
- `/projects` — authenticated project home
- `/projects/new` — adaptive project diagnostic
- `/projects/[projectId]` — constellation editor
- `/projects/[projectId]/blueprint` — interactive Blueprint and snapshots
- `/settings` — provider credentials and routing

The visual language applies across the full platform. Marketing and authentication surfaces use the same neutral typography, borders, spacing, controls, and theme tokens with simpler composition and lower interaction density.

## 13. Backend domains and persistence

The FastAPI backend remains authoritative for ownership, semantic graph state, revisions, proposals, analysis, caching, and Blueprint snapshots.

Backend domains include:

- Projects
- Graph nodes and edges
- Canvas layout, annotations, and media references
- Node revisions
- Hermes proposals and challenges
- Analysis dependencies and cache
- Blueprint snapshots
- Existing provider routing and encrypted credentials

Supabase persistence remains local-only under the current project contract. New tables and RPCs must be owner-scoped, guarded, and covered by local integration tests. No remote Supabase operation is allowed without explicit user approval.

Semantic graph content is stored separately from high-frequency canvas positions. Mutable records use optimistic versions. Proposal acceptance is atomic. Blueprint snapshots are immutable payloads associated with a project version.

## 14. Hermes request flow

1. The client submits the selected node, intent, expected project version, and idempotency key.
2. The backend authorizes project ownership.
3. The backend resolves the relevant subgraph and deterministic cache key.
4. A valid cache hit returns prior analysis without a provider call.
5. A miss invokes the user's configured provider route and fallbacks.
6. The provider response passes strict structured-output validation.
7. Valid suggestions are persisted as proposals, not graph mutations.
8. The client previews proposals.
9. User acceptance performs an atomic, version-checked graph update.

The existing synchronous provider request model remains for the MVP. The canvas stays usable while analysis runs. Persistent background workers, realtime collaboration, and multi-user editing are out of scope.

## 15. Failure handling and recovery

- Graph editing remains available when Hermes or a provider fails.
- Node saves are independent from AI analysis.
- Failed analysis leaves graph state unchanged and offers retry.
- Accepted proposals are atomic; partial acceptance cannot occur.
- Temporary network loss queues pending edits locally and retries after reconnection.
- Closing with pending edits produces an explicit warning.
- Version conflicts preserve both versions and offer compare, keep mine, or accept latest.
- Failed Blueprint generation preserves exact snapshot inputs for retry.
- Invalid model output is a typed provider failure and cannot mutate graph state.
- Provider exhaustion preserves the user's current selection, draft, and viewport.
- Secrets, prompts, provider payloads, and unreleased brand material remain owner-scoped and excluded from logs.

## 16. Accessibility and performance

Every essential graph action has an equivalent structured list or tree representation. Nodes and edges remain keyboard focusable and operable. Selection and graph mutations are announced. Relationship types use text and line patterns in addition to color.

The MVP must support visible focus, complete keyboard operation, screen readers, reduced motion, 44-by-44-pixel touch targets, and WCAG 2.2 AA contrast in Paper, Graphite, and Project themes.

Performance measures include:

- memoized custom nodes and edges;
- isolated high-frequency viewport state;
- collapsed distant clusters and hidden inactive branches;
- simplified styles at distant zoom levels;
- transform- and opacity-based transitions;
- no layout animation during dragging; and
- a test fixture containing at least 250 visible nodes and 400 edges.

## 17. Existing workflow and rollout

The constellation and Projects routes will be built alongside the current guided workspace. Existing creative sessions remain available as read-only legacy projects. The application will not automatically infer graph evidence or relationships from the old workflow, and rollout will not destructively migrate or discard session data.

The new project experience becomes primary only after the complete acceptance journey, accessibility checks, performance fixture, documentation, and project gates pass.

Campaign creation remains a later branch that can consume an approved Brand Constellation.

## 18. Testing and acceptance

### 18.1 Automated coverage

- Backend unit coverage for graph invariants, relationships, revisions, proposal atomicity, challenges, caching, invalidation, and Blueprint compilation
- Owner-isolation and optimistic-conflict coverage for every project operation
- Local-only Supabase integration coverage with loopback hostname proof
- Structured-output coverage for every Hermes analysis schema
- Vitest coverage for graph reducers, annotation reducers, selection, undo and redo, proposal previews, and theme derivation
- Playwright coverage for the complete desktop and mobile journey
- Keyboard and structured-list equivalents for essential graph operations
- Reduced-motion and all-theme coverage
- Proof that annotation edits cannot mutate semantic graph records
- Desktop and mobile visual evidence
- Large-graph performance fixture
- Proof that unchanged cached analysis makes zero provider calls
- PDF version-label and snapshot-consistency coverage
- Imported-component provenance and license inventory

### 18.2 MVP acceptance journey

1. Sign up and create a project.
2. Complete the adaptive diagnostic.
3. Capture and connect ideas directly.
4. Explore one area with Hermes.
5. Receive and resolve an active challenge.
6. Compare competing branches.
7. Approve enough decisions for Blueprint readiness.
8. Generate the interactive Starter Brand Blueprint.
9. Export a dated PDF snapshot.
10. Sign out, return, and recover the project unchanged.

## 19. Deliberate MVP omissions

- Autonomous external research
- Realtime multi-user collaboration
- Persistent background-job infrastructure
- Finished logo production and full asset libraries
- Campaign generation in the new graph
- Public Blueprint sharing
- Slides, DOCX, and editable design-file exports
- Remote Supabase setup or mutation
- A proprietary graph-rendering engine

## 20. Documentation ownership

Implementation must update authoritative documentation in the same change:

- `PRODUCT.md` — audience, product purpose, and product principles
- `DESIGN.md` — versatile workbench system, theme tokens, graph interaction, accessibility, and motion rules
- `docs/CLIENT_FLOW.md` — project, diagnostic, constellation, challenge, and Blueprint behavior
- `docs/API.md` — project graph, proposal, analysis, cache, conflict, and snapshot contracts
- `docs/SUPABASE.md` — local schema, migrations, rollback, and safety
- `README.md` — setup, dependencies, and verification
- `docs/DEVLOG.md` — concise project history

## 21. Source references

- React Flow documentation: <https://reactflow.dev/>
- React Flow viewport guidance: <https://reactflow.dev/learn/concepts/the-viewport>
- React Flow accessibility: <https://reactflow.dev/learn/advanced-use/accessibility>
- React Flow performance: <https://reactflow.dev/learn/advanced-use/performance>
- Motion for React: <https://motion.dev/docs/react>
- 21st.dev component registry: <https://21st.dev/>
- Internal visual and interaction reference: `origin/ui-updates` commit `774011b`, reviewed on 2026-07-26
