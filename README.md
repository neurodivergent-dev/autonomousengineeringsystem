⚡ MetaFrame Autonomous Engineering System
### Unified Codebase Intelligence, AST Knowledge Graph & Closed-Loop Agentic Architecture

[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun%201.3+-F472B6?style=flat-square&logo=bun)](https://bun.sh)
[![Language: TypeScript](https://img.shields.io/badge/Language-TypeScript%205.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Local LLM: Ollama](https://img.shields.io/badge/Local--First-Ollama-000000?style=flat-square&logo=ollama)](https://ollama.com)
[![Architecture: AST-Driven](https://img.shields.io/badge/Architecture-AST%20Grounded-10B981?style=flat-square)](https://github.com)
[![Guardrails: 6--Gate](https://img.shields.io/badge/Safety-6--Gate%20Closed--Loop-8B5CF6?style=flat-square)](https://github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

> **MetaFrame is not just another LLM code generator.** It is a deterministic, compiler-grounded software engineering platform that enforces architectural discipline through **TypeScript AST knowledge graphs, transitive blast-radius calculation, and a 6-gate safety validation chain**.

---

## 🎯 The Core Philosophy: Why Vector RAG Fails for Code

Most AI coding assistants rely on **Vector RAG (naive text chunking & cosine similarity)** or **brute-force context window dumping**. This leads to:
* **Context Blindness:** The model sees snippets but has no understanding of import/export trees or call hierarchies.
* **Severe Token Inefficiency:** Burning 50,000 to 100,000 tokens per interaction just reading raw files.
* **Hallucinated Refactoring:** Editing a function without knowing that 14 different screens and hooks depend on it.
* **Lack of Determinism:** Asking an LLM *"did you break anything?"* (it always says "looks great!").

### The MetaFrame Solution
1. **Zero-Token-Waste AST Intelligence:** Instead of dumping raw source code, agents query compact 15-line **Identity Cards**, exact caller sites (`callers <fnName>`), JSX render sites (`where <Component>`), and transitive dependency graphs (`impact <path>`).
2. **Deterministic Closed-Loop Guardrails:** Changes are strictly checked against mathematical, compiler-level gates (`tsc`, AST linters, design tokens). If a gate fails, the compiler errors are fed back into the agent for immediate self-correction.
3. **Traceability Matrix:** No code is written without an implementation plan; no plan is approved without an Architecture Decision Record (ADR); and no ADR exists without a Product Requirement (PRD).

---

## 🏗️ System Topology & Workflow

```
                                  [ User Feature Intent ]
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MetaFrame Multi-Agent Orchestrator                              │
│                                                                                        │
│   ┌─────────────────────┐    ┌───────────────────────────┐    ┌────────────────────┐   │
│   │ 1. Product Discovery│───▶│ 2. Solutions Architecture │───▶│ 3. Implementation  │   │
│   │ (PRD / Acceptance)  │    │ (ADR / Blast-Radius Risk) │    │    Planner         │   │
│   └─────────────────────┘    └───────────────────────────┘    └────────────────────┘   │
│              ▲                             ▲                             │             │
│              └───────────────────────┬─────┴─────────────────────────────┘             │
│                                      │                                                 │
│                                      ▼                                                 │
│                        ┌───────────────────────────┐                                   │
│                        │ 4. Technical Docs & Specs │                                   │
│                        │ (Living Architecture Spec)│                                   │
│                        └───────────────────────────┘                                   │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │
         ┌─────────────────────────────┴─────────────────────────────┐
         ▼                                                           ▼
┌────────────────────────────────┐                         ┌────────────────────────────────┐
│  AST Codebase Intelligence     │                         │  6-Gate Deterministic Chain    │
│  (repo-intelligence-layer)     │                         │  (Closed-Loop Guardrails)      │
│  • knowledge_graph.json        │                         │  • Gate 1: TypeScript (0 err)  │
│  • depencies.js (Callers/Deps) │                         │  • Gate 2: Blast Radius Impact │
│  • route-navigator.js (Screens)│                         │  • Gate 3: Theme Token Audit   │
│  • supabase-mapper.js (DB/RPC) │                         │  • Gate 4: Zero-Emoji UX Guard │
│  • AST Node Identity Cards     │                         │  • Gate 5: i18n Bridge Integrity│
│  • Zero-Token-Waste Ingestion  │                         │  • Gate 6: AST Anti-Patterns   │
└────────────────────────────────┘                         └────────────────────────────────┘
         │                                                           │
         └─────────────────────────────┬─────────────────────────────┘
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                 Persistent Engineering Knowledge Layer (.metaframe/)                   │
│                                                                                        │
│      PRD-xxxx (Spec) ◄──► ADR-xxxx (Decision) ◄──► PLAN-xxxx (Steps) ◄──► AST Code     │
│                             Bidirectional Traceability Matrix                          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ The 6-Gate Deterministic Safety Chain

Before any code modification is proposed or committed, it must pass through the **6-Gate Deterministic Safety Chain** in milliseconds:

| Gate | Target Tool | Deterministic Enforcement Criteria |
| :--- | :--- | :--- |
| **1. TypeScript** | `tsc --noEmit` | **Strict 0-error requirement.** Type definitions and contracts must remain 100% sound. |
| **2. Blast Radius** | `blast-radius.js impact` | Transitive dependency graph calculation. Detects upstream breakages before code touches disk. |
| **3. Theme Tokens** | `theme-audit.js` | Rejects hardcoded Tailwind hex codes (`#123456`) and raw CSS colors in favor of design tokens. |
| **4. Zero-Emoji** | `emoji-linter.js` | Flags user-visible emoji literals in UI/JSX nodes to maintain enterprise UX hygiene. |
| **5. i18n Bridge** | `i18n-indexer.js` | Enforces translation keys for UI copy; interfaces with the two-stage AI translation judge. |
| **6. AST Code Health**| `code-health.js` | Zero empty catch blocks (`NO_EMPTY_CATCH`), zero `as any` escapes, zero abandoned `debugger;`. |

---

## 🧩 Unified Subsystem Ecosystem

The repository unifies three specialized subsystems:

```
autonomousengineeringsystem/
│
├── 🧠 repo-intelligence-layer/      # AST Analysis, Caller Graphs & Safety Gates
│   ├── analysis.tsx                 # Bun background file watcher & AST parser (Port 5959)
│   ├── scripts/depencies.js         # Token-free AST queries (callers, deps, render sites)
│   ├── scripts/blast-radius.js      # 6-gate pre-commit validation engine
│   ├── scripts/code-health.js       # Zero-dependency AST anti-pattern scanner
│   ├── scripts/route-navigator.js   # Navigation tree, screens, and router caller mapper
│   └── scripts/supabase-mapper.js   # Database tables, RPCs, and SQL migration map
│
├── 🤖 mini-meta-cli/                # Lightweight ReAct Agent Runtime
│   ├── engine.ts                    # Think-Act-Observe loop
│   ├── ollama.ts                    # Fast fetch-based LLM streaming client
│   ├── parser.ts                    # Claude-style XML tool-call parser (<tool_call>)
│   ├── permissions.ts               # Destructive shell command guard
│   └── tools/                       # Exact-diff file editor, grep, glob, shell, web
│
├── 🌐 i18next-local-inference/      # AI Translation & Two-Stage Judge Dashboard
│   ├── i18n-dashboard.tsx           # Fullstack Bun/React server (Port 5960)
│   └── scripts/                     # AI validation distinguishing cognates from missing keys
│
├── 📁 .metaframe/                   # Persistent Engineering Knowledge Base
│   ├── prds/                        # PRD-xxxx.json & .md (Product Requirements)
│   ├── adrs/                        # ADR-xxxx.json & .md (Architecture Decisions)
│   ├── plans/                       # PLAN-xxxx.json & .md (Ordered Implementation Tasks)
│   └── traceability.json            # Bidirectional Traceability Graph
│
└── 🚀 src/                          # MetaFrame Core Orchestration Engine (Bun + TS)
    ├── types/                       # Core domain schemas
    ├── intelligence/ast-bridge.ts   # Programmatic Bun wrapper for repo intelligence
    ├── gates/gate-runner.ts         # Fast in-process 6-gate safety runner
    ├── knowledge/store.ts           # File-backed persistence & traceability engine
    ├── llm/client.ts                # Multi-provider client (Ollama / OpenAI / Gemini / Claude)
    ├── agents/                      # Discovery, Architect, Planner & Lead Orchestrator
    └── cli.ts                       # Unified CLI interface
```

---

## 🚀 Quick Start

### Prerequisites
* [Bun](https://bun.sh) (v1.1+)
* [Node.js](https://nodejs.org) (v18+)
* *(Optional)* [Ollama](https://ollama.com) for 100% local, offline inference (`ollama pull qwen2.5:7b` or `gemma4:26b`)

### Installation
MetaFrame has **zero external package manager dependencies** for core operation:
```bash
git clone https://github.com/your-username/autonomousengineeringsystem.git
cd autonomousengineeringsystem
```

---

## 💻 CLI Reference & Usage

### 1. Run the End-to-End Autonomous Engineering Pipeline (`plan`)
Transforms a feature request into an AST-grounded PRD, ADR, Implementation Plan, and Gate Verification:
```bash
bun src/cli.ts plan "Add biometric authentication support to user session"
```
**Output:**
* `PRD-xxxx.md`: Scoped product requirements and acceptance criteria.
* `ADR-xxxx.md`: Architectural decision record with blast-radius risk evaluation.
* `PLAN-xxxx.md`: Atomic file-by-file modification plan with test assertions.
* Pre-flight dry-run of the 6-gate safety chain.
* Updated `.metaframe/traceability.json`.

---

### 2. Run the 6-Gate Closed-Loop Safety Chain (`verify`)
Runs all 6 deterministic gates across the project or against a single file:
```bash
# Verify entire codebase:
bun src/cli.ts verify

# Verify a specific file:
bun src/cli.ts verify src/examples/bad-code.ts
```

---

### 3. Inspect the Traceability Matrix (`trace`)
Displays the living trace linking requirements to codebase entities:
```bash
bun src/cli.ts trace
```
```
┌───┬──────────┬──────────┬───────────┬────────────────────┬────────┐
│   │ PRD      │ ADR      │ Plan      │ Files              │ Status │
├───┼──────────┼──────────┼───────────┼────────────────────┼────────┤
│ 0 │ PRD-2806 │ ADR-2817 │ PLAN-2819 │ core, src/index.ts │ DRAFT  │
└───┴──────────┴──────────┴───────────┴────────────────────┴────────┘
```

---

### 4. Zero-Token AST Queries (`query` & `impact`)
Query the repository structure without spending a single LLM token:
```bash
# Search symbols, components, and purpose across the AST:
bun src/cli.ts query "authenticateUser"

# Calculate transitive blast radius for any file:
bun src/cli.ts impact src/agents/orchestrator.ts
```

---

### 5. Launch the Local Interactive Coding Agent (`cli:mini`)
Launch the lightweight ReAct CLI with safe shell execution and exact string editing:
```bash
bun run cli:mini
```

---

### 6. Launch the AI i18n Dashboard (`i18n`)
Start the visual translation management and two-stage AI judge server:
```bash
bun run i18n
# Open http://localhost:5960
```

---

## ⚙️ Model Configuration (Local-First or Cloud)

MetaFrame operates **100% locally by default via Ollama**, but supports external APIs via environment variables:

| Mode | Configuration |
| :--- | :--- |
| **Local Ollama (Default)** | Default: `http://localhost:11434` · Model: `qwen2.5:7b` / `gemma4:26b` |
| **OpenAI (GPT-4o / o3)** | `$env:METAFRAME_PROVIDER="openai"`, `$env:LLM_API_KEY="sk-..."`, `$env:METAFRAME_MODEL="gpt-4o"` |
| **Google Gemini** | `$env:METAFRAME_PROVIDER="openai"`, `$env:OLLAMA_HOST="https://generativelanguage.googleapis.com/v1beta/openai"`, `$env:LLM_API_KEY="AIzaSy..."`, `$env:METAFRAME_MODEL="gemini-2.5-flash"` |

---

## 📜 Traceability Contract

MetaFrame strictly enforces three engineering laws:
1. **No Plan Without an ADR:** Code modifications cannot proceed without a recorded and evaluated architectural decision.
2. **No ADR Without a Requirement:** Every architectural decision must trace directly back to an approved PRD.
3. **No Commit Without Green Gates:** Any failure in TypeScript compilation, blast radius threshold, design tokens, or AST code health automatically aborts the pipeline and triggers agent self-correction.

---

## 📄 License

MIT License © 2026 MetaFrame Autonomous Engineering System.
#   a u t o n o m o u s e n g i n e e r i n g s y s t e m 
 
 
