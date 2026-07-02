# Deep Recon R1: Explorer Report — gemma-chat-public

**Date:** 2026-07-01  
**Agent:** Explorer (Round 1)  
**Target:** `/Users/aldoyh/Projects/AI/gemma-chat-public/`

---

## 1. Filesystem Scan — Complete Inventory

### 1.1 Source tree (`src/`)

```
src/
├── main/                          [Electron main process]
│   ├── index.ts                   (824 lines) — IPC handlers, window mgmt, agent loop, singleflight
│   ├── mlx.ts                     (871 lines) — MLX-LM venv install, server lifecycle, SSE streaming
│   ├── tools.ts                   (609 lines) — 10 tool definitions, system prompts (chat + code), XML parser
│   ├── workspace.ts               (397 lines) — Sandboxed filesystem, static HTTP server, bash execution
│   ├── ollama.ts                  (46 lines)  — Ollama detection + model listing helpers
│   ├── html-assets.ts             (42 lines)  — HTML CSS/JS injection helper
│   ├── write-file-args.ts         (5 lines)   — Extract content from write_file args
│   ├── types.ts                   (13 lines)  — Backend manager types (re-exports from inference/)
│   ├── example-recipes.ts         (330 lines) — Retro calculator + coffee landing page templates
│   ├── test-support/
│   │   └── pure.ts                (11 lines)  — Pure-logic re-exports for unit tests
│   └── inference/
│       ├── base.ts                (48 lines)  — BackendType, InferenceBackend interface, StreamChunk
│       ├── mlx-backend.ts         (129 lines) — MLXBackend wrapping mlx.ts as a backend
│       ├── ollama-backend.ts      (126 lines) — OllamaBackend using OpenAI-compatible API
│       ├── gguf-backend.ts        (67 lines)  — GGUFBackend (stub — disabled, throws clear errors)
│       ├── message-format.ts      (75 lines)  — Message folding for Gemma's strict user/assistant format
│       └── index.ts               (75 lines)  — Backend factory + routing logic
├── preload/
│   ├── index.ts                   (101 lines) — contextBridge API with typed IPC wrappers
│   └── index.d.ts                 (10 lines)  — Type declarations for window.api
├── renderer/
│   ├── index.html                 (HTML entry)
│   ├── assets/
│   │   └── animated-favicon.svg
│   └── src/
│       ├── main.tsx               (8 lines)
│       ├── env.d.ts               (19 lines)
│       ├── styles.css             (~520 lines)
│       ├── App.tsx                (236 lines)
│       ├── components/            (14 components, ~3,300 LOC)
│       ├── lib/                   (2 files)
│       ├── i18n/                  (3 files)
│       └── assets/                (2 files)
└── shared/
    └── types.ts                   (167 lines)

### 1.2 Build artifacts

| Path | Size | Type |
|------|------|------|
| `out/main/index.js` | ~900KB | Built main process bundle |
| `out/preload/index.mjs` | ~4KB | Built preload script |
| `out/renderer/index.html` | HTML | Rendered entry point |
| `out/renderer/assets/` | ~few MB | Built CSS + JS + WASM + PNG |
| `dist-test/` | 40KB (4 files) | esbuild-bundled test modules |
| `build/icon.icns` | — | App icon |

### 1.3 Config files

| File | Purpose |
|------|---------|
| `package.json` | npm config, scripts, deps |
| `electron-builder.yml` | macOS DMG packaging config |
| `electron.vite.config.ts` | Build pipeline (main + preload + renderer) |
| `tsconfig.json` | Root TS project references |
| `tsconfig.node.json` | TS config for main/preload |
| `tsconfig.web.json` | TS config for renderer |
| `postcss.config.js` | PostCSS with Tailwind |
| `.gitignore` | Ignores node_modules, out, dist, models, etc. |

### 1.4 Scripts (test suite)

| Script | Lines | Purpose |
|--------|-------|---------|
| `scripts/test-all.mjs` | 257 | **7 sections, 26+ tests** — message-format, action parser, content cleaner, HTML assets, write-file args, prompt hygiene, model registry |
| `scripts/test-e2e-electron.mjs` | 109 | Playwright E2E: launch real Electron, type prompt, capture reply |
| `scripts/test-ipc-integration.mjs` | 148 | Spawn MLX server, POST formatted messages, verify SSE streaming |
| `scripts/test-landing-prompt.mjs` | ~293 | Full end-to-end: spawn MLX, send landing page prompt, parse XML action |
| `scripts/test-ollama.mjs` | 129 | Smoke test Ollama's OpenAI-compatible endpoint |
| `scripts/mac-release.mjs` | 140 | Typecheck → build → validate → install to /Applications |

### 1.5 Documentation

**`docs/superpowers/plans/`**:
- `2026-05-24-ollama-first-revision.md` — Ollama as primary backend; MLX fallback (13 tasks, 919 lines)
- `2026-05-16-auto-select-activity-thinking.md` — Auto-select countdown, ActivityIndicator, fractal animation (8 tasks)
- `2026-05-16-gguf-model-support.md` — Pluggable backend system, GGUF/llama.cpp support (11 tasks)

**`docs/superpowers/specs/`**:
- `2026-05-24-ollama-first-revision-design.md` — Approved spec for Ollama-first architecture

### 1.6 Not tracked/ignored

- `node_modules/`, `out/`, `dist/`, `release/`, `.vite/`, `.cache/` — all in `.gitignore`
- `*.gguf`, `*.safetensors`, `*.onnx`, `models/`, `workspaces/` — model weights excluded
- `mlx-venv/` — auto-provisioned at runtime
- Hidden: `.claude/settings.local.json`, `.aider-desk/`, `.aider.chat.history.md`, `.aider.input.history`

### 1.7 LOC Summary (source only)

| Layer | Files | Approx LOC |
|-------|-------|-----------|
| `src/main/` (core) | 12 files | ~3,250 |
| `src/main/inference/` | 6 files | ~520 |
| `src/preload/` | 2 files | ~111 |
| `src/renderer/src/` (comps) | 14 components | ~3,300 |
| `src/renderer/src/` (lib/i18n) | 5 files | ~215 |
| `src/shared/` | 1 file | ~167 |
| **Total source** | **~40 files** | **~7,563** |

---

## 2. Architecture Deep-Dive

### 2.1 Startup Flow (App.tsx → state machine)

```
BOOT → check Ollama → check MLX → SETUP (Welcome screen or auto-proceed) → READY → SWITCHING (when model changes)
```

### 2.2 Agent Loop (index.ts, handleChat)

For each user message in **Build (code) mode**:
1. Build baseMessages: system prompt + history + latest message
2. Format via formatMessagesForMLX (folds system/tool → user)
3. Stream tokens from backend (MLX/Ollama)
4. Emit StreamChunk events: `token`, `activity`, `tool_call`, `tool_result`, `metrics`, `done`/`error`
5. If tool call: execute → append result → repeat (up to **40 rounds**)
6. Partial file writes flush every ~450ms
7. FileChangeEvent → workspace listener → iframe auto-reload

### 2.3 XML Action Protocol

Instead of JSON, model emits `<action name="write_file"><path>...</path><content>...</content></action>`. Parsed by `findNextAction()` with regex support for nested content.

### 2.4 Tools (10 total)

| Tool | Mode | Description |
|------|------|-------------|
| write_file | code | Write content to workspace file |
| read_file | code | Read file contents |
| edit_file | code | Smart find-and-replace edit |
| delete_file | code | Delete file |
| list_files | code | List workspace tree |
| run_bash | code | Safety-filtered bash execution |
| open_preview | code | Open preview in browser |
| web_search | chat | DuckDuckGo HTML scrape (no API key) |
| fetch_url | chat | Fetch + HTML→text conversion |
| calc | chat | Arithmetic evaluation |

```

### 2.5 Message Folding (message-format.ts)

Critical Gemma compatibility layer:
- Gemma chat templates **reject** `system` and `tool` roles (HTTP 404)
- `formatMessagesForMLX()` folds system → `"System instructions:\n{content}"` prepended to first user message
- Folds tool → `"Tool result:\n{content}"` prepended to next user turn
- Adjacent same-role messages merged with `\n\n`
- Only `user` and `assistant` roles in output

### 2.6 Backend Abstraction (inference/)

```
InferenceBackend (interface)
  ├── MLXBackend       — wraps mlx.ts (Python subprocess + mlx_lm server)
  ├── OllamaBackend     — wraps ollama.ts (HTTP to localhost:11434)
  └── GGUFBackend       — STUB (disabled, throws clear errors)
```

Factory pattern: `createBackend()`, `switchBackend()`, `getCurrentBackend()`.

### 2.7 MLX Server Lifecycle (mlx.ts, 871 lines)

**Venv:** Detects Python 3.10–3.13, creates venv, installs `mlx-lm>=0.24.0`. Extensive error handling with stale venv detection and pip repair.

**Server:** Starts `mlx_lm server` with `--port`, `--prompt-cache-size 0`, `--decode-concurrency 1`. Polls `/v1/models` up to 180s. Killed on `app.on('will-quit')`.

**Download:** Uses `mlx_lm.from_pretrained` with progress callbacks. **Singleflight**: concurrent calls share the same promise to prevent race conditions from React StrictMode.

**Chat:** POST to `/v1/chat/completions` with SSE streaming. Applies `formatMessagesForMLX` before sending.

### 2.8 Workspace (workspace.ts, 397 lines)

- Per-conversation `workspaces/{conversationId}/` directory
- Path traversal: rejects `..` or leading `/`
- Bash safety: blocks `rm -rf /`, `sudo`, `>/dev/sda`, etc.
- Static HTTP server with MIME types, named pipe port allocation

### 2.9 Whisper STT (whisper.ts)

- `@huggingface/transformers.js` pipeline `'automatic-speech-recognition'`
- Model: `onnx-community/whisper-base.en`
- WebGPU first, WASM fallback
- Audio via MediaRecorder → WebAudio decode (16kHz mono) → resample → transcribe

---

## 3. Unique vs. Conventional

### 3.1 What's Unique / Ahead

| Aspect | Gemma Chat | Conventional |
|--------|------------|-------------|
| XML action protocol | XML for tool calls — small models handle it more reliably | JSON function calling (OpenAI spec) |
| Message folding | Folds system/tool into user turns for Gemma | Assumes native role support |
| Singleflight loads | Prevents StrictMode race conditions | Rarely handled |
| macOS persistence | Stays alive after window close | Most quit with last window |
| 3-backend architecture | MLX + Ollama + GGUF | Usually lock into one runtime |
| Per-conversation sandbox | Isolated filesystem per chat | Shared workspaces |
| DuckDuckGo web search | No API key required | Usually require SerpAPI/Bing |
| In-browser Whisper | WASM/WebGPU, completely local | Usually cloud STT or native macOS |
| Arabic i18n | Full RTL + Tajawal font | Rare in AI coding tools |
| 40-round agent loop | Aggressive iteration for Build mode | Usually fewer rounds |
| GemmaBug mascot | Animated SVG walking bug | Unique brand touch |
| esbuild test suite | No test framework, node:assert only | Usually Jest/Vitest |


---

## 4. Competitive Landscape

### 4.1 Direct Competitors (local LLM + code generation)

| Project | Stars | Description | Key Difference |
|---------|-------|-------------|---------------|
| **LM Studio** | ~500K+ downloads | Desktop app for running local LLMs | No coding agent / tool use |
| **Ollama** | ~120K+ stars | CLI/local server for models | No UI, no coding agent |
| **Open WebUI** | ~75K+ stars | Web UI for Ollama backends | Web app, broader feature set |
| **Continue.dev** | ~30K+ stars | VS Code extension for local LLM coding | IDE extension, more mature |
| **AnythingLLM** | 62.4K stars | Desktop app for local AI with RAG | General AI workspace, not coding-focused |
| **vibe-agent** | 0 stars | Electron + React + TS, vibe coding with local LLMs | Very new, similar concept |
| **CoWork-OS** | 369 stars | Local-first agentic OS for coding | Broader scope, multi-agent |
| **Off-Grid AI Mobile** | 2.6K stars | Mobile offline LLM app | Mobile-only |

### 4.2 Key Market Observations

1. **No dominant Electron-based local vibe coding app exists** — the niche is wide open
2. Most local AI coding tools are CLI-based (Ollama, llama.cpp) or IDE extensions (Continue.dev, Cody)
3. The "vibe coding" space is rapidly growing since Karpathy popularized the term
4. Gemma Chat's main competition is **Continue.dev** — VS Code extension with local model support
5. **Unique moat**: Complete offline pipeline (STT → LLM → Code → Preview) in zero-config Electron app

---

## 5. Technical Risks & Maintenance Concerns

### 5.1 High Priority

| Risk | Impact | Notes |
|------|--------|-------|
| **MLX-LM Python subprocess** | Brittle | 871-line mlx.ts interacts with system Python in unpredictable states; version conflicts, pip failures |
| **Apple Silicon only** | Addressable market | No Linux/Windows/CUDA. Ollama backend mitigates but adds dependency |
| **Gemma model dependency** | Fragile | Tied to Google's Gemma models; if quality lags behind Qwen/DeepSeek/Llama, users need Ollama |
| **XML action reliability** | Model-dependent | Small models produce malformed XML; fragile regex parser |
| **localStorage persistence** | Data loss risk | No export, no sync, no backup. User clears browser data → conversations lost |

### 5.2 Medium Priority

| Risk | Impact |
|------|--------|
| **GGUF backend is a stub** | Users who expect GGUF get blocked by thrown errors |
| **DDG web scraping** | Regex-based parsing breaks when HTML changes; rate-limiting possible |
| **Whisper ~150MB download** | First voice input triggers unexpected download |
| **bash execution safety** | Safety filters allow node/python/git/curl/npm — clever prompts may bypass |
| **No CI for E2E tests** | E2E test exists but requires manual build + running MLX server |
| **React StrictMode × singleflight** | Singleflight pattern corrects for double-mount, but must be right for all paths |

### 5.3 Low Priority / Opportunities

- **`ThinkingAnimation.tsx` and `FractalThinkingAnimation.tsx` are identical** — code duplication
- **`electron-updater` with placeholder URL** — auto-update configured but not actually working
- **No LICENSE file** — `package.json` says MIT but no file in root
- **Test suite uses esbuild bundling** — clever but non-standard, might confuse contributors

---

## 6. Git History & Development Patterns

### 6.1 Commit Themes (30 commits)

| Theme | Count |
|-------|-------|
| Ollama integration | 13 commits |
| UI/UX polish | 6 commits |
| Backend abstraction | 5 commits |
| GGUF support | 3 commits |
| Testing | 1 commit |
| i18n | 2 commits |
| Docs | 1 commit |

**Key observations:**
- Heavy Ollama integration phase (13 of last 20 commits)
- Systematic refactoring from MLX-only to multi-backend
- Recent UI polish (GemmaBug, Tailwind 4, ambient backdrops)
- No CI — all commits direct to `main`
- Aider-assisted development (`.aider-desk/` present)

---

## 7. External Context

### 7.1 MLX-LM Status
- Package moved to standalone `ml-explore/mlx-lm` repo
- Pins `mlx-lm>=0.24.0`
- Supports Gemma 2/4, Llama, Mistral, Qwen, DeepSeek, and more
- OpenAI-compatible `/v1/chat/completions` endpoint

### 7.2 Gemma 4 Model Family
- **E2B** (~1.5GB), **E4B** (~3GB), **12B** (~8GB), **27B MoE** (~16GB), **31B** (~18GB)
- Context: up to 256K tokens
- Multimodal: text, audio, image input (MLX support may vary)
- Upstream recommends E4B; local code defaults to Gemma 2 2B (more conservative)

### 7.3 Upstream vs Local Differences
- Upstream: E4B recommended, 4 models, no Ollama mention
- Local: Gemma 2 2B default, 6 models, Ollama-first architecture added by @aldoyh

---

## 8. Key Numbers

| Metric | Value |
|--------|-------|
| Total source files | ~40 |
| Total source LOC | ~7,563 |
| Main process LOC | ~3,770 |
| Renderer components | 14 |
| Inference backends | 3 (1 stub) |
| Tools | 10 |
| Registered models | 6 |
| Test sections | 7 |
| Total tests | 26+ |
| Commits | 30 |
| Contributors | 2 |
| Electron | 42.x |
| React | 19.x |
| TypeScript | 6.x |

---

## 9. Summary for Orchestrator

**Strengths:**
- Complete offline pipeline: STT → LLM → Code → Preview
- Elegant 3-backend architecture (MLX/Ollama/GGUF)
- Innovative XML action protocol for small models
- Strong UX: animations, i18n, responsive, zero-config
- Thorough test infrastructure

**Weaknesses:**
- Apple Silicon only (MLX lock-in)
- localStorage-only persistence
- GGUF backend is a stub
- DDG scraping is fragile
- No CI/CD

**Opportunities:**
- First-mover in Electron-based local vibe coding app space
- Ollama opens Qwen/DeepSeek/Llama models
- MCP protocol alignment would future-proof
- Code quality is well-structured, typed, tested

**Risks:**
- MLX Python subprocess management is complex and brittle
- Heavy reliance on Gemma model ecosystem
- XML action parsing may fail with small models
- Auto-update not configured despite `electron-updater` dependency

### 3.2 What's Conventional / Behind

| Aspect | Gemma Chat | State of Art |
|--------|------------|-------------|
| No VS Code extension | Standalone Electron app | Most integrate as IDE extensions |
| No MCP support | Custom XML protocol | Growing MCP ecosystem standard |
| No RAG | No vector DB / document retrieval | Most coding agents support context |
| No image generation | Text + code only | Some generate SVG, diagrams |
| No multi-model chat | Single model at a time | Some ensemble or cascade models |
| No robust persistence | localStorage only | Most use SQLite or IndexedDB |
| Apple Silicon only | MLX lock-in | Most support cross-platform |
| No fine-tuning | Off-the-shelf models only | Some offer LoRA/QLoRA |
| No git integration | No auto-commit / diff | Many coding agents show diffs |

