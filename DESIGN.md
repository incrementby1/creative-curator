---
name: Creative Curator
description: A precise creative-decision workspace for solo brand owners.
colors:
  ink: "oklch(24% 0.008 145)"
  muted-ink: "oklch(47% 0.010 145)"
  canvas: "oklch(97% 0.008 90)"
  surface: "oklch(99% 0.004 90)"
  surface-muted: "oklch(94% 0.008 90)"
  border: "oklch(87% 0.010 90)"
  rust: "oklch(52% 0.120 35)"
  rust-hover: "oklch(46% 0.110 35)"
  success: "oklch(48% 0.080 145)"
  danger: "oklch(48% 0.120 25)"
typography:
  headline:
    fontFamily: "Aptos, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Aptos, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 620
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Aptos, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Aptos, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "4px"
  md: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "44px"
---

# Design System: Creative Curator

## 1. Overview

**Creative North Star: "The Clear Workbench"**

Creative Curator should feel like a well-arranged work surface: quiet until needed, precise under pressure, and organized around the decision in front of the user. The interface serves solo brand owners who may need a fast campaign answer today and durable brand context next month. Familiar product patterns, concise language, and visible system state create trust.

This target system replaces the current publication-like treatment. It rejects oversized serif display type, staggered editorial compositions, decorative texture, glowing AI surfaces, and card grids used as page structure. It keeps the existing warm identity through mineral neutrals and a restrained rust accent, then applies them with Notion-like discipline.

**Key Characteristics:**

- Flat, task-first product surfaces
- One sans-serif family and compact, fixed type hierarchy
- Mineral neutrals with rust reserved for focus and meaningful state
- Borders and tonal shifts before shadows
- Clear labels, inline feedback, and persistent user context

## 2. Colors

Mineral neutrals reduce glare without suggesting a magazine page. Rust gives the product a recognizable voice without becoming decoration.

### Primary

- **Workbench Ink** (`oklch(24% 0.008 145)`): Primary text, strong controls, and selected high-emphasis states.
- **Measured Rust** (`oklch(52% 0.120 35)`): Focus rings, current navigation, links, and sparse decision-state emphasis.
- **Deep Rust** (`oklch(46% 0.110 35)`): Rust hover and active states.

### Neutral

- **Mineral Canvas** (`oklch(97% 0.008 90)`): Page background.
- **Clean Surface** (`oklch(99% 0.004 90)`): Inputs and grouped work surfaces.
- **Quiet Surface** (`oklch(94% 0.008 90)`): Side navigation, disabled regions, and secondary grouping.
- **Structural Line** (`oklch(87% 0.010 90)`): Dividers and component borders.
- **Muted Ink** (`oklch(47% 0.010 145)`): Secondary text that still meets WCAG 2.2 AA on intended surfaces.

### Named Rules

**The Ten Percent Rule.** Rust occupies no more than ten percent of a normal workspace view. It communicates focus, selection, or recovery, never atmosphere.

**The State Needs Words Rule.** Success, warning, and error colors always appear with text or an icon label. Color never carries meaning alone.

## 3. Typography

**Display Font:** Aptos (with Segoe UI, Helvetica, Arial, and sans-serif fallbacks)
**Body Font:** Aptos (with Segoe UI, Helvetica, Arial, and sans-serif fallbacks)

**Character:** One familiar sans-serif family keeps the tool professional and removes the current editorial split. Hierarchy comes from restrained size, weight, spacing, and grouping.

### Hierarchy

- **Headline** (650, `2rem`, 1.15): Route titles and first-level task headings.
- **Title** (620, `1.25rem`, 1.3): Major grouped sections and named creative directions.
- **Body** (400, `1rem`, 1.55): Instructions, descriptions, and form content; prose stays within 70 characters per line.
- **Label** (600, `0.875rem`, 1.3): Controls, navigation, field labels, and state text. Sentence case is default.

### Named Rules

**The Product Type Rule.** No serif type, fluid display scaling, all-caps micro-label systems, or headings larger than needed to orient the task.

## 4. Elevation

System is flat by default. Canvas, surface tone, and one-pixel borders establish hierarchy. Shadows are reserved for temporary layers such as mobile navigation, menus, and sticky action bars that physically overlap content.

### Shadow Vocabulary

- **Overlay** (`0 8px 24px oklch(24% 0.008 145 / 0.12)`): Menus, drawers, and overlapping action regions only.

### Named Rules

**The Flat-By-Default Rule.** Persistent content does not float. If a border or tonal layer can explain structure, no shadow is added.

## 5. Components

Components feel restrained and familiar. Every interactive element provides default, hover, focus, active, disabled, loading, and error behavior where applicable.

### Buttons

- **Shape:** Compact rounded rectangle (`8px`), minimum `44px` target.
- **Primary:** Workbench Ink background, Clean Surface text, `12px 16px` padding.
- **Hover / Focus:** Tonal darkening on hover; `3px` Measured Rust focus ring with `2px` offset. No layout-shifting movement.
- **Secondary:** Clean Surface background, Structural Line border, Workbench Ink text.
- **Destructive:** Text-first danger treatment, separated spatially from normal actions.

### Chips

- **Style:** Use only for compact metadata or filters, not status prose. Structural Line border, `4px` radius, sentence-case label.
- **State:** Selected chips add Quiet Surface fill and explicit selected semantics.

### Cards / Containers

- **Corner Style:** `8px` for bounded entities; page sections usually need no enclosing card.
- **Background:** Clean Surface or transparent over Mineral Canvas.
- **Shadow Strategy:** None at rest.
- **Border:** One-pixel Structural Line when boundaries matter.
- **Internal Padding:** `16px` compact, `24px` standard.

### Inputs / Fields

- **Style:** Clean Surface, one-pixel Structural Line, `8px` radius, visible labels, `44px` minimum height.
- **Focus:** Measured Rust border and `3px` low-chroma focus ring.
- **Error / Disabled:** Error appears directly below field with recovery instruction. Disabled fields retain readable text and explicit disabled semantics.
- **Secrets:** API keys use password fields, clear provider labels, masked saved state, replace and delete actions, and no raw value redisplay.

### Navigation

Desktop uses persistent side navigation with sentence-case sans-serif labels and a restrained active background. Mobile uses one accessible drawer with focus containment and return. Settings is a top-level destination; provider configuration and model routing are secondary settings sections.

### Provider Connection Row

Each provider is one scannable row, not a promotional card. It shows provider name, connection state in words, masked credential status, selected model, and one contextual action. Expanded editing stays inline beneath the row so configuration remains anchored to its source.

## 6. Do's and Don'ts

### Do:

- **Do** use the `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, and `48px` spacing scale.
- **Do** keep primary actions at least `44px` high and provide visible keyboard focus.
- **Do** validate fields on blur, place errors beside the field, and include a recovery action.
- **Do** preserve drafts, sessions, and user settings across expected navigation and login cycles.
- **Do** use one consistent SVG icon family and pair unfamiliar icons with labels.
- **Do** test `375px`, `768px`, `1024px`, and `1440px` layouts plus reduced-motion behavior.

### Don't:

- **Don't** use editorial-magazine styling, including oversized serif headlines, ornamental layouts, or content staged like a publication.
- **Don't** use generic AI-product styling, including gradient text, glowing surfaces, glass-heavy cards, decorative automation diagrams, or vague assistant copy.
- **Don't** use glossy SaaS presentation patterns that make configuration and creative work feel like a marketing page.
- **Don't** invent novel controls or decorative motion for standard workflows.
- **Don't** use colored side-stripe alerts, nested cards, identical promotional card grids, or modals as the first solution.
- **Don't** animate layout properties, remove focus outlines, rely on hover alone, or communicate status with color alone.

## 7. Spatial workbench themes

Brand Constellation uses one invariant workbench geometry with three semantic-token themes. **Paper** is warm neutral and remains fallback. **Graphite** uses opaque dark neutrals, never translucent glass. **Project** keeps Paper's neutral chrome and may derive only a bounded interface accent from an approved, accessible visual-palette decision. Source palette values remain immutable; unsafe interface accents fall back to measured rust. Platform success, warning, error, relationship, and Hermes challenge colors never derive from project content.

Authenticated global default persists through user settings. Nullable project override takes precedence; effective order is project override, global default, then Paper. Theme switching changes tokens only: DOM order, geometry, keyboard order, accessible names, and status language stay fixed.

Semantic roles include canvas, panel, elevated panel, text, muted text, border, hover, selection, focus, handles, five relationship types, warning, error, success, and Hermes challenge. Status always includes words or accessible names. All combinations target WCAG 2.2 AA.

Motion for React communicates panel presence, proposal preview, focus, node entry/removal, and Blueprint mode changes. `MotionConfig` honors user preference; `useReducedMotion` removes nonessential traversal/presence. React Flow exclusively owns node drag and resize, while direct pointer handling owns freehand drawing. No decorative loops, glass depth, bloom, skewed gradients, layout-shifting hover, or theme flash.

Component sourcing and deliberate prototype rejections are recorded in [`docs/COMPONENT_PROVENANCE.md`](docs/COMPONENT_PROVENANCE.md).
