# MetaFrame Autonomous Engineering System
### Unified Codebase Intelligence, AST Knowledge Graph & Closed-Loop Agentic Architecture

[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun%201.3+-F472B6?style=flat-square&logo=bun)](https://bun.sh)
[![Language: TypeScript](https://img.shields.io/badge/Language-TypeScript%205.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-orange?style=flat-square)](https://modelcontextprotocol.io)
[![Local LLM: Ollama](https://img.shields.io/badge/Local--First-Ollama-000000?style=flat-square&logo=ollama)](https://ollama.com)
[![Architecture: AST-Driven](https://img.shields.io/badge/Architecture-AST%20Grounded-10B981?style=flat-square)](https://github.com)
[![Guardrails: 6--Gate](https://img.shields.io/badge/Safety-6--Gate%20Closed--Loop-8B5CF6?style=flat-square)](https://github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

> **MetaFrame is not just another LLM code generator.** It is a deterministic, compiler-grounded software engineering platform that enforces architectural discipline through **TypeScript AST knowledge graphs, transitive blast-radius calculation, a 6-gate safety validation chain, and a native Model Context Protocol (MCP) server**.

---

## 🎯 The Core Philosophy: Why Vector RAG Fails for Code

Most AI coding assistants rely on **Vector RAG (naive text chunking & cosine similarity)** or **brute-force context window dumping**. This leads to:
* **Context Blindness:** The model sees snippets but has no understanding of import/export trees, call hierarchies, or JSX render sites.
* **Severe Token Inefficiency:** Burning 50,000 to 100,000 tokens per interaction just reading raw files.
* **Hallucinated Refactoring:** Editing a function without knowing that 14 different screens and hooks depend on it.
* **Lack of Determinism:** Asking an LLM *"did you break anything?"* (it always says "looks great!").

### The MetaFrame Solution
1. **Zero-Token-Waste AST Intelligence:** Instead of dumping raw source code, agents query compact 15-line **Identity Cards**, exact caller sites (`callers <fnName>`), JSX render sites (`where <Component>`), and transitive dependency graphs (`impact <path>`).
2. **Universal Target Repo Adapter:** Run the entire autonomous engineering suite against **any arbitrary repository** on your system without modifying target repo configuration.
3. **Sub-Second AST Graph Generator (`index`):** Parses 600+ TypeScript/JavaScript files in <700ms using the native TypeScript Compiler API.
4. **Deterministic Closed-Loop Guardrails:** Changes are strictly checked against mathematical, compiler-level gates (`tsc`, AST linters, design tokens, zero emoji, i18n integrity). If a gate fails, the compiler errors are fed back into the agent for immediate surgical repair (`self-healing`).
5. **Model Context Protocol (MCP) Server:** Native Stdio MCP server exposing 6 tools for Antigravity, Cursor, and Claude Desktop.
6. **Traceability Matrix:** No code is written without an implementation plan; no plan is approved without an Architecture Decision Record (ADR); and no ADR exists without a Product Requirement (PRD).

---

## 🏗️ System Topology & Workflow

```
                                  [ User Feature Intent ]
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MetaFrame Multi-Agent Orchestrator                              │
│                                                                                        │
│   ┌─────────────────────┐     ┌────────────────────────────┐     ┌─────────────────┐   │
│   │ 1. Product Discovery│────▶│ 2. Solutions Architecture  │────▶│ 3. Implementation│   │
│   │ (PRD / Acceptance)  │     │ (ADR / Blast-Radius Risk)  │     │    Planner      │   │
│   └─────────────────────┘     └────────────────────────────┘     └─────────────────┘   │
│              │                               │                            │            │
│              ▼                               ▼                            ▼            │
│      .metaframe/prds/                .metaframe/adrs/             .metaframe/plans/    │
│                                              │                            │            │
│                                              ▼                            ▼            │
│                              ┌─────────────────────────────────────────────────────┐   │
│                              │       AST Knowledge Graph & Blast-Radius Engine     │   │
│                              │ (Transitive Dependents · Callers · JSX Render Sites)│   │
│                              └─────────────────────────────────────────────────────┘   │
│                                              │                                         │
│                                              ▼                                         │
│                              ┌─────────────────────────────────────────────────────┐   │
│                              │       Autonomous Code Executor & Healer Loop        │   │
│                              │       (Local LLM: Gemma 4 / Qwen 2.5 / GPT-4o)      │   │
│                              └─────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────┬─────────────────────────────────────────┘
                                               │
                                               ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      Deterministic 6-Gate Closed-Loop Safety Chain                     │
├────────────────────────────────┬───────────────────────────────┬───────────────────────┤
│ 1. TypeScript Compiler (Zero)  │ 2. Transitive Blast Radius    │ 3. Theme Enforcer     │
├────────────────────────────────┼───────────────────────────────┼───────────────────────┤
│ 4. Zero-Emoji UX Guard         │ 5. i18n Translation Integrity │ 6. AST Code Health    │
└────────────────────────────────┴───────────────────────────────┴───────────────────────┘
                                               │
                      ┌────────────────────────┴────────────────────────┐
                      ▼                                                 ▼
             [ ✔ PASS: Commit Safe ]                           [ ✖ FAIL: Engage Healer ]
```

---

## ⚡ Quick Start

### Prerequisites
* **Bun 1.3+** installed (`curl -fsSL https://bun.sh/install | bash` or `powershell -c "irm bun.sh/install.ps1 | iex"`)
* *(Optional)* **Ollama** running locally for local-first generation (`ollama serve`)

```bash
# Clone the repository
git clone https://github.com/neurodivergent-dev/autonomousengineeringsystem.git
cd autonomousengineeringsystem

# Install dependencies (blazing fast with Bun)
bun install
```

---

## 💻 CLI Commands & Universal Target Adapter

All commands support the **`-t <path>` / `--target <path>`** flag or the `TARGET_REPO` environment variable, enabling you to inspect, verify, and orchestrate changes across **any external codebase**.

### 1. Auto-Generate AST Knowledge Graph (`index`)
Scans target files, extracts symbols, functions, components, hooks, imports, and renders, and creates a pre-computed knowledge graph:
```bash
# Index the current repository:
bun src/cli.ts index

# Index an external target project:
bun src/cli.ts index -t "C:\path\to\your\project"
```
*⚡ Benchmarked: Parses and maps **643 files with 1,338 dependency edges in 693ms**.*

---

### 2. Run the 6-Gate Closed-Loop Safety Chain (`verify`)
Runs all 6 deterministic gates across the project or against a single file:
```bash
# Verify entire codebase:
bun src/cli.ts verify

# Verify target repository:
bun src/cli.ts verify -t "C:\path\to\your\project"

# Verify a specific file in target repo:
bun src/cli.ts verify components/AISubscriptionPricing.tsx -t "C:\path\to\your\project"
```

---

### 3. One-Shot Topology & Health Analysis (`analyze`)
Inspects route maps, Supabase client/schema mapping, and 6-gate health status in a single unified report:
```bash
bun src/cli.ts analyze -t "C:\path\to\your\project"
```

---

### 4. Transitive Blast Radius Calculation (`impact`)
Calculates exactly what files and screens break if you touch a specific component:
```bash
bun src/cli.ts impact components/AISubscriptionPricing.tsx -t "C:\path\to\your\project"
```
**Output Example:**
```text
Impact Analysis for: components/AISubscriptionPricing.tsx
Risk Rating: MEDIUM
Affected Files (3):
  • components/OnboardingSlides.tsx
  • app/(modal)/ai-subscription.tsx
  • app/(auth)/onboarding.tsx
```

---

### 5. AST Semantic Queries (`query`)
Instant zero-token search for symbols, callers, components, and purpose:
```bash
bun src/cli.ts query "AISubscriptionPricing" -t "C:\path\to\your\project"
```

---

### 6. Autonomous Engineering Pipeline (`plan` & `build`)
Transforms a feature request into an AST-grounded PRD, ADR, Implementation Plan, and Gate Verification:
```bash
# Planning mode (PRD -> ADR -> Plan -> Gate Preflight):
bun src/cli.ts plan "Add biometric authentication support to user session" -t "C:\path\to\your\project"

# Full Autonomous Build mode (Generates & writes code with self-healing gates):
bun src/cli.ts build "Create cyber matrix dashboard in apps/dashboard/index.html" -t "C:\path\to\your\project"
```

---

### 7. Inspect the Traceability Matrix (`trace`)
Displays the living trace linking requirements to codebase entities:
```bash
bun src/cli.ts trace -t "C:\path\to\your\project"
```

---

## 🖥️ MetaFrame Studio (Standalone AI IDE)

MetaFrame includes its own dedicated, ultra-lightweight desktop AI IDE (`apps/studio`) built with **Tauri v2 + React 19 + Monaco Editor** and styled with the **MetaFrame Cyber** OLED dark theme:

* **VS Code Engine:** Embedded `@monaco-editor/react` with zero false-positive diagnostics, custom token highlighting, and `Ctrl+S` auto-testing.
* **Live Aegis 6-Gate HUD:** Real-time indicator pills displaying compiler status, theme token audit, and emoji guard.
* **Blast Radius Radar:** Automatic risk calculation and affected screens list for the currently active tab.
* **Agent Copilot Drawer:** Interactive chat with Orion, Daedalus, and Vulcan for atomic planning and code generation.

```bash
# Start the MetaFrame Studio Backend:
bun run studio

# Start the MetaFrame Studio Desktop UI:
bun run studio:ui
```

---

## 🔌 Antigravity & IDE Integration (Model Context Protocol)

MetaFrame includes a native **Stdio MCP Server** (`@modelcontextprotocol/sdk`) that allows Antigravity, Cursor, and Claude Desktop to leverage MetaFrame tools directly.

### Registered MCP Tools
| Tool Name | Description |
| :--- | :--- |
| `metaframe_index` | Scans target repo with TypeScript AST and generates `ai-reports/knowledge_graph.json`. |
| `metaframe_verify_gates` | Runs the deterministic 6-Gate safety chain on the repository or specific files. |
| `metaframe_blast_radius` | Computes transitive blast radius, risk level, and affected screens. |
| `metaframe_ast_query` | Queries callers, render sites, dependents, or identity cards from AST graph. |
| `metaframe_supabase_map` | Maps Supabase database tables, SQL migrations, and client service/screen usage. |
| `metaframe_orchestrate_plan`| Runs multi-agent PRD -> ADR -> Plan generation grounded in AST topology. |

### Configuration (`mcp_config.json`)
Add the following to your `~/.gemini/config/mcp_config.json` (or workspace MCP settings):

```json
{
  "mcpServers": {
    "MetaFrame": {
      "command": "bun",
      "args": [
        "run",
        "C:\\Users\\Melih\\Documents\\Projects\\autonomousengineeringsystem\\src\\mcp\\server.ts"
      ],
      "env": {
        "TARGET_REPO": "C:\\path\\to\\active\\project"
      }
    }
  }
}
```

---

## 🛡️ The Deterministic 6-Gate Safety Chain

Every code modification passes through Aegis, MetaFrame's automated quality inspector:

1. **Gate 1 — TypeScript Compiler (`tsc --noEmit`):**
   * Zero TypeScript compiler errors required. Any type mismatch, missing property, or signature failure immediately fails the gate.
2. **Gate 2 — Transitive Blast Radius (`blast-radius.js`):**
   * Traverses reverse dependency trees. Flags changes touching core infrastructure or >5 dependent screens as high risk.
3. **Gate 3 — Theme Token Enforcer (`theme-audit.js`):**
   * Blocks hardcoded color strings (`#4F8EF7`, `rgba(...)`) and raw Tailwind color utilities, enforcing design tokens.
4. **Gate 4 — Zero-Emoji UX Guard (`emoji-linter.js`):**
   * Scans JSX/UI elements and blocks raw Unicode emojis in production interfaces, enforcing professional SVG icons.
5. **Gate 5 — i18n Translation Integrity (`i18n-indexer.js`):**
   * Verifies that newly added strings are mapped to localization keys across all configured languages (`translations/`, `locales/`).
6. **Gate 6 — AST Code Health & Anti-Patterns (`code-health.js`):**
   * Blocks empty `catch` blocks (silent errors), forgotten `debugger`/`console.log` leftovers, and uncontrolled `as any` type escapes.

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
