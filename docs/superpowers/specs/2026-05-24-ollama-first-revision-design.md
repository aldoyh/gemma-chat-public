---
name: ollama-first-revision
description: Gemma Chat revised to use Ollama as primary backend with MLX/GGUF fallback chain
metadata:
  type: project
---

# Gemma Chat — Ollama-First Revision

**Date:** 2026-05-24  
**Status:** Approved

## Goal

Make Gemma Chat work with any locally-running LLM immediately (via Ollama), while fully preserving the original MLX Gemma model flow as the fallback when Ollama is not detected.

## Backend Priority Chain

1. **Ollama** — auto-detected at startup via `localhost:11434`. If reachable, use it and skip the setup wizard entirely.
2. **MLX** — fallback when Ollama is absent. Installs Python venv + mlx-lm, downloads original Gemma models from HuggingFace. All original `AVAILABLE_MODELS` preserved.
3. **GGUF** — manual opt-in at all times. User picks a local `.gguf` file.

## Startup Flow

```
App starts
  → ping Ollama /v1/models
    ├─ OK  → OllamaBackend, skip wizard, open chat with live model picker
    └─ fail → ping MLX venv
                ├─ ready → MLXBackend, load default Gemma 2 2B
                └─ not ready → show Setup wizard (install MLX → download Gemma)
```

## Architecture

### New files
- `src/main/ollama.ts` — Ollama detection (`isOllamaRunning()`), model listing (`listOllamaModels()`)
- `src/main/inference/ollama-backend.ts` — `OllamaBackend` implementing `InferenceBackend`

### Modified files
- `src/shared/types.ts` — add `'ollama'` to `ModelSource`; add `OllamaModelInfo` type
- `src/main/index.ts` — auto-detect Ollama on `app.whenReady`, wire `OllamaBackend` into `ensureBackendRunning`
- `src/main/inference/index.ts` — add `'ollama'` to `BackendType`, create `OllamaBackend` in factory
- `src/renderer/src/App.tsx` — Ollama detection branch: skip Setup, go straight to Chat with model picker
- `src/renderer/src/components/Setup.tsx` — add Ollama source option and live model dropdown

### Untouched
- `mlx.ts`, all MLX install/download/repair logic
- `gguf-backend.ts`
- `AVAILABLE_MODELS`, `DEFAULT_MODEL`
- Tools, workspace, code mode, message format, i18n

## Ollama Backend Detail

- `initialize()`: GET `/v1/models` — throws if Ollama not running
- `loadModel(name)`: sets `this.currentModel = name`, instant (Ollama manages model loading)
- `listModels()`: GET `/api/tags` → returns `model.name` array
- `chat(opts)`: POST `/v1/chat/completions` with `stream: true` — same SSE parsing as existing MLX chat
- System messages: passed as-is (Ollama supports them natively, no folding required)
- `getStatus()`: `installed: true` if `/v1/models` returns 200

## UI Behaviour

- **Ollama active**: Chat opens directly. Sidebar model picker lists live Ollama models.
- **MLX active**: Existing Setup wizard + model list exactly as today.
- **Backend badge**: Small pill in sidebar footer showing active backend (Ollama / MLX / GGUF).

## Build & Install

```bash
npm run dist                          # electron-builder → out/mac-arm64/Gemma Chat.app
cp -R "out/mac-arm64/Gemma Chat.app" "/Applications/Gemma Chat.app"
open -a "Gemma Chat"
```

## Success Criteria

- App auto-detects Ollama and opens chat immediately (no setup wizard) when Ollama is running
- All existing Ollama models are selectable in the model picker
- When Ollama is stopped, app correctly falls back to MLX setup wizard
- MLX Gemma model download and chat still works end-to-end
- GGUF local file still works
- App builds to a signed `.app` and launches from /Applications
