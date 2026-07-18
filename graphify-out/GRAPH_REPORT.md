# Graph Report - .  (2026-07-18)

## Corpus Check
- Corpus is ~1,673 words - fits in a single context window. You may not need a graph.

## Summary
- 194 nodes · 130 edges · 72 communities (18 shown, 54 thin omitted)
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Dom Compileroptions Allowjs
- Agent Llm Hermes
- Types Eslint Tailwindcss
- React Next Dom
- Next Types Tsconfig
- Next Documentation Create
- Transformers Huggingface Hub
- Layout Geistmono Geistsans
- Bun Http Localhost
- Store Update Brand
- Globe Earth Global
- Opencode Plugin Schema
- Fastapi Pydantic Starlette
- Next Breaking Changes
- Window Controls Close
- Graphify Graphifyplugin Important
- Httpx Openai
- Eslint Config Mjs
- Next Config Nextconfig
- Next Env Note
- Config Postcss Mjs
- Next Logo Wordmark
- Vercel Logo
- Font Geist Family
- Annotated Doc
- Annotated Types
- Anyio
- Certifi
- Click
- Colorama
- Distro
- Filelock
- Fsspec
- H11
- Xet
- Httpcore
- Idna
- Jinja2
- Jiter
- Joblib
- Markdown
- Markupsafe
- Mdurl
- Mpmath
- Narwhals
- Networkx
- Numpy
- Packaging
- Pydantic Core
- Pygments
- Pyyaml
- Regex
- Rich
- Safetensors
- Scikit Learn
- Scipy
- Setuptools
- Shellingham
- Sniffio
- Sympy
- Threadpoolctl
- Tqdm
- Typer
- Typing Extensions
- Typing Inspection
- Uvicorn
- File Document Icon
- App Page

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `Hermes` - 8 edges
3. `include` - 7 edges
4. `MemoryAgent` - 5 edges
5. `scripts` - 5 edges
6. `Next.js` - 5 edges
7. `CriticAgent` - 4 edges
8. `DirectionAgent` - 4 edges
9. `lib` - 4 edges
10. `http://localhost:3000` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Hermes` --uses--> `CriticAgent`  [INFERRED]
  backend/app/core/hermes.py → backend/app/agents/critic_agent.py
- `Hermes` --uses--> `DirectionAgent`  [INFERRED]
  backend/app/core/hermes.py → backend/app/agents/direction_agent.py
- `Hermes` --uses--> `MemoryAgent`  [INFERRED]
  backend/app/core/hermes.py → backend/app/agents/memory_agent.py
- `@AGENTS.md` --references--> `Next.js breaking changes warning`  [EXTRACTED]
  client/CLAUDE.md → client/AGENTS.md

## Import Cycles
- None detected.

## Communities (72 total, 54 thin omitted)

### Community 0 - "Dom Compileroptions Allowjs"
Cohesion: 0.11
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 1 - "Agent Llm Hermes"
Cohesion: 0.14
Nodes (6): CriticAgent, DirectionAgent, MemoryAgent, Hermes, cheap_llm(), creative_llm()

### Community 2 - "Types Eslint Tailwindcss"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+9 more)

### Community 3 - "React Next Dom"
Cohesion: 0.12
Nodes (15): dependencies, next, react, react-dom, name, private, scripts, build (+7 more)

### Community 4 - "Next Types Tsconfig"
Cohesion: 0.20
Nodes (9): exclude, include, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts (+1 more)

### Community 5 - "Next Documentation Create"
Cohesion: 0.29
Nodes (7): create-next-app, Learn Next.js, Next.js, Next.js deployment documentation, Next.js Documentation, Next.js GitHub repository, Vercel Platform

### Community 6 - "Transformers Huggingface Hub"
Cohesion: 0.40
Nodes (5): huggingface_hub, sentence-transformers, tokenizers, torch, transformers

### Community 7 - "Layout Geistmono Geistsans"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

### Community 8 - "Bun Http Localhost"
Cohesion: 0.40
Nodes (5): bun dev, http://localhost:3000, npm run dev, pnpm dev, yarn dev

### Community 11 - "Globe Earth Global"
Cohesion: 0.50
Nodes (4): Earth globe, Global network / worldwide, Globe icon (SVG), Internationalization / language selection

### Community 12 - "Opencode Plugin Schema"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 13 - "Fastapi Pydantic Starlette"
Cohesion: 0.67
Nodes (3): fastapi, pydantic, starlette

### Community 14 - "Next Breaking Changes"
Cohesion: 0.67
Nodes (3): Next.js breaking changes warning, node_modules/next/dist/docs/, @AGENTS.md

### Community 15 - "Window Controls Close"
Cohesion: 1.00
Nodes (3): UI Window, Window Controls (Close/Minimize/Maximize), Window SVG Icon

## Knowledge Gaps
- **121 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `geistSans`, `geistMono`, `metadata` (+116 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **54 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Types Eslint Tailwindcss` to `React Next Dom`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `compilerOptions` connect `Dom Compileroptions Allowjs` to `Next Types Tsconfig`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Hermes` (e.g. with `CriticAgent` and `DirectionAgent`) actually correct?**
  _`Hermes` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `MemoryAgent` (e.g. with `Hermes` and `.__init__()`) actually correct?**
  _`MemoryAgent` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `geistSans` to the rest of the system?**
  _121 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dom Compileroptions Allowjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Agent Llm Hermes` be split into smaller, more focused modules?**
  _Cohesion score 0.13725490196078433 - nodes in this community are weakly interconnected._