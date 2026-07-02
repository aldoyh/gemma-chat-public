import { app, shell, BrowserWindow, ipcMain, nativeTheme, session, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { cpus, loadavg } from 'os'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@shared/types'
import {
  switchBackend,
  getCurrentBackend,
  getCurrentBackendType,
  shutdownBackend,
  type InferenceBackend
} from './inference'
import { ensureCleanFirstRunModelState, listCachedModels, locateMLX } from './mlx'
import { isOllamaRunning, listOllamaModels, ollamaModelToInfo } from './ollama'
import {
  TOOLS,
  chatSystemPrompt,
  codeSystemPrompt,
  enhancePromptSystem,
  findNextAction,
  emitSafeBoundary,
  runTool,
  cleanFileContent,
  type ToolContext
} from './tools'
import { getExampleRecipe, type ExampleRecipe } from './example-recipes'
import { abortAll } from './abort-registry'
import {
  ensureWorkspace,
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServerPort,
  previewUrl,
  listTree,
  workspaceDir,
  wsWriteFile
} from './workspace'
import type { ChatRequest, EnhancePromptRequest, StreamChunk, ToolCall, ModelConfig } from '../shared/types'

// Single instance lock — prevents multiple app instances from running simultaneously
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

let mainWindow: BrowserWindow | null = null

// Singleflight guard for model-load IPC. React StrictMode and HMR remounts
// can fire `setup:start` / `model:switch` twice in quick succession. Without
// a guard, both calls race into ensureBackendRunning → startServer and the
// second spawn loses to the first on port 11435 (`Address already in use`).
const modelLoadInflight = new Map<string, Promise<void>>()
function singleflightModelLoad(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = modelLoadInflight.get(key)
  if (existing) return existing
  const next = fn().finally(() => modelLoadInflight.delete(key))
  modelLoadInflight.set(key, next)
  return next
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e0e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (!app.isPackaged) {      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

function getCPULoad(): number {
  // On macOS, use os.loadavg() as approximation
  // This is a simple approach - in production you'd use proper CPU metrics
  const avgLoad = loadavg()[0]
  const numCPUs = cpus().length
  return Math.min(100, Math.round((avgLoad / numCPUs) * 100))
}

async function ensureBackendRunning(modelConfig: ModelConfig): Promise<InferenceBackend> {
  const backend = getCurrentBackend()
  const backendType = getCurrentBackendType()
  const targetType = modelConfig.source === 'mlx' ? 'mlx' : modelConfig.source === 'ollama' ? 'ollama' : 'gguf'

  const onProgress = (p: {
    message: string
    progress?: number
    remainingSeconds?: number
    totalSeconds?: number
  }) => {
    send('setup:status', {
      stage: targetType === 'mlx' ? 'starting-mlx' : 'downloading-model',
      message: p.message,
      progress: p.progress,
      remainingSeconds: p.remainingSeconds
    })
  }

  // If backend already running with same config, ensure model is loaded
  if (backend && backendType === targetType) {
    if (targetType === 'mlx' && modelConfig.model) {
      await backend.loadModel(modelConfig.model, onProgress)
    } else if (targetType === 'gguf' && modelConfig.path) {
      await backend.loadModel(modelConfig.path, onProgress)
    } else if (targetType === 'ollama' && modelConfig.model) {
      await backend.loadModel(modelConfig.model, onProgress)
    }
    return backend
  }

  // Switch to the appropriate backend
  send('setup:status', {
    stage: 'checking',
    message: `Preparing ${modelConfig.source} backend…`
  })

  try {
    if (modelConfig.source === 'mlx') {
      await ensureCleanFirstRunModelState((message) => {
        send('setup:status', {
          stage: 'checking',
          message
        })
      })

      // 1. Initialize backend
      await switchBackend('mlx')
      const mlxBackend = getCurrentBackend()
      if (!mlxBackend) throw new Error('Failed to initialize MLX backend')

      // 2. Check installation
      const status = await mlxBackend.getStatus()
      if (!status.installed) {
        send('setup:status', {
          stage: 'installing-mlx',
          message: 'Installing MLX runtime…'
        })
        await mlxBackend.install((p) => {
          send('setup:status', {
            stage: 'installing-mlx',
            message: p.message
          })
        })
      }

      // 3. Load model
      const modelName = modelConfig.model || DEFAULT_MODEL
      await mlxBackend.loadModel(modelName, onProgress)

      return mlxBackend
    } else if (modelConfig.source === 'gguf') {
      // GGUF path: use local file
      if (!modelConfig.path) {
        throw new Error('GGUF path required for local model source')
      }

      await switchBackend('gguf', { modelPath: modelConfig.path })
      const ggufBackend = getCurrentBackend()
      if (!ggufBackend) throw new Error('Failed to initialize GGUF backend')

      await ggufBackend.loadModel(modelConfig.path, onProgress)

      return ggufBackend
    } else if (modelConfig.source === 'ollama') {
      const modelName = modelConfig.model
      if (!modelName) throw new Error('Ollama model name required')

      await switchBackend('ollama')
      const ollamaBackend = getCurrentBackend()
      if (!ollamaBackend) throw new Error('Failed to initialize Ollama backend')

      send('setup:status', { stage: 'starting-mlx', message: `Connecting to Ollama (${modelName})…` })
      await ollamaBackend.loadModel(modelName, onProgress)

      return ollamaBackend
    } else {
      throw new Error(`Unknown model source: ${modelConfig.source}`)
    }
  } catch (e) {
    throw new Error(`Backend initialization failed: ${(e as Error).message}`)
  }
}

async function handleSetup(modelConfig: ModelConfig): Promise<void> {
  try {
    send('setup:status', { stage: 'checking', message: 'Checking system…' })
    await ensureBackendRunning(modelConfig)
    send('setup:status', { stage: 'ready', message: 'Ready to chat.' })
  } catch (e) {
    send('setup:status', {
      stage: 'error',
      message: 'Setup failed',
      error: (e as Error).message
    })
  }
}

const MAX_TOOL_ROUNDS_CHAT = 6
const MAX_TOOL_ROUNDS_CODE = 12

function actionTarget(_name: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.path === 'string') return args.path
  if (typeof args.query === 'string') return String(args.query)
  if (typeof args.url === 'string') return String(args.url)
  if (typeof args.command === 'string')
    return String(args.command).slice(0, 80)
  return undefined
}

function parsePartialWriteFile(buffer: string): { path: string; content: string } | null {
  const open = buffer.match(/<action\s+name\s*=\s*["']?write_file["']?\s*>/i)
  if (!open || open.index == null) return null

  const actionBody = buffer.slice(open.index + open[0].length)
  const path = actionBody.match(/<path>([^<]+)<\/path>/i)?.[1]?.trim()
  if (!path) return null

  const contentOpen = actionBody.match(/<content>/i)
  if (!contentOpen || contentOpen.index == null) return null

  let content = actionBody.slice(contentOpen.index + contentOpen[0].length)
  const closeIdx = content.search(/<\/content>/i)
  if (closeIdx >= 0) content = content.slice(0, closeIdx)
  if (content.startsWith('\n')) content = content.slice(1)
  if (content.trim().length < 10) return null

  return { path, content }
}

async function runExampleRecipe(
  recipe: ExampleRecipe,
  ctx: ToolContext,
  emit: (chunk: StreamChunk) => void
): Promise<void> {
  for (const file of recipe.files) {
    const args: Record<string, unknown> = { path: file.path, content: file.content }
    const call: ToolCall = {
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'write_file',
      args,
      running: true
    }
    emit({ type: 'tool_call', call })
    emit({ type: 'activity', activity: { kind: 'tool', tool: 'write_file', target: file.path } })
    const result = await runTool('write_file', args, ctx)
    emit({ type: 'tool_result', id: call.id, result })
  }

  const previewCall: ToolCall = {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: 'open_preview',
    args: {},
    running: true
  }
  emit({ type: 'tool_call', call: previewCall })
  emit({ type: 'activity', activity: { kind: 'tool', tool: 'open_preview' } })
  const previewResult = await runTool('open_preview', {}, ctx)
  emit({ type: 'tool_result', id: previewCall.id, result: previewResult })
  emit({ type: 'token', text: recipe.summary })
  emit({ type: 'activity', activity: { kind: 'idle' } })
  emit({ type: 'done' })
}

async function handleChat(req: ChatRequest, channel: string): Promise<void> {
  const abort = new AbortController()
  chatAbortControllers.set(req.conversationId, abort)

  const emit = (chunk: StreamChunk): void => send(channel, chunk)

  let cpuUpdateInterval: NodeJS.Timeout | null = null

  try {
    // Start CPU monitoring
    cpuUpdateInterval = setInterval(() => {
      const cpu = getCPULoad()
      send(channel, { type: 'metrics', cpuPercent: cpu })
    }, 500)
    const baseMessages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> = []

    if (req.mode === 'code') {
      const wsPath = await ensureWorkspace(req.conversationId)
      const href = previewUrl(req.conversationId)
      baseMessages.push({ role: 'system', content: codeSystemPrompt(wsPath, href) })
    } else {
      baseMessages.push({ role: 'system', content: chatSystemPrompt(req.enableTools) })
    }

    for (const m of req.messages) {
      baseMessages.push({ role: m.role as 'user' | 'assistant' | 'system' | 'tool', content: m.content })
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (tc.result != null) {
            baseMessages.push({
              role: 'tool',
              content: `Result of <action name="${tc.name}">: ${tc.result}`
            })
          }
        }
      }
    }

    const ctx: ToolContext = {
      conversationId: req.conversationId,
      onFileChange: () => send('workspace:changed', { conversationId: req.conversationId })
    }

    const useTools = req.mode === 'code' || req.enableTools
    const maxRounds = req.mode === 'code' ? MAX_TOOL_ROUNDS_CODE : MAX_TOOL_ROUNDS_CHAT

    if (req.mode === 'code') {
      const lastUserPrompt = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const recipe = getExampleRecipe(lastUserPrompt)
      if (recipe) {
        await runExampleRecipe(recipe, ctx, emit)
        return
      }
    }

    emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })

    for (let round = 0; round < maxRounds; round++) {
      let buffer = ''
      let emittedIdx = 0
      let firstToken = true
      let executedAction = false
      let lastActivityTs = 0
      let pendingAction: { name: string; target?: string } | null = null

      // Live-write state for write_file streaming
      let livePath: string | null = null
      let liveContentStart = -1
      let lastLiveWrite = 0
      let livePending: Promise<unknown> | null = null
      let lastEmittedContent = ''
      const writeLivePartial = (): void => {
        if (!livePath || liveContentStart < 0 || livePending) return
        let partial = buffer.slice(liveContentStart)
        if (partial.startsWith('\n')) partial = partial.slice(1)
        const closeIdx = partial.indexOf('</content>')
        if (closeIdx >= 0) partial = partial.slice(0, closeIdx)
        const cleaned = cleanFileContent(partial, livePath)
        if (cleaned !== lastEmittedContent) {
          lastEmittedContent = cleaned
          send('file:streaming', {
            conversationId: req.conversationId,
            path: livePath,
            content: cleaned,
            done: false
          })
        }
        livePending = wsWriteFile(req.conversationId, livePath, cleaned)
          .then(() => {
            send('workspace:changed', { conversationId: req.conversationId })
          })
          .catch(() => {
            /* tolerate partial write failures */
          })
          .finally(() => {
            livePending = null
          })
      }

      const emitActivity = (): void => {
        const now = Date.now()
        if (now - lastActivityTs < 400) return
        lastActivityTs = now
        if (pendingAction) {
          emit({
            type: 'activity',
            activity: {
              kind: 'tool',
              tool: pendingAction.name,
              target: pendingAction.target,
              chars: buffer.length
            }
          })
        } else {
          emit({ type: 'activity', activity: { kind: 'generating', chars: buffer.length } })
        }
      }

      const backend = getCurrentBackend()
      if (!backend) {
        throw new Error('No inference backend available. Call handleSetup first.')
      }

      const genTemp = req.mode === 'code' ? 0.45 : 0.75
      streamLoop: for await (const chunk of backend.chat({
        model: req.model,
        messages: baseMessages,
        signal: abort.signal,
        temperature: genTemp
      })) {
        if (chunk.content) {
          if (firstToken) {
            firstToken = false
            emit({ type: 'activity', activity: { kind: 'generating', chars: 0 } })
          }
          buffer += chunk.content

          // Forward raw token to devtools console for debugging
          mainWindow?.webContents.send('chat:raw', {
            conversationId: req.conversationId,
            chunk: chunk.content
          })

          // Detect if we've started an action (for activity label + live writes)
          if (!pendingAction) {
            const openMatch = buffer
              .slice(emittedIdx)
              .match(/<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/i)
            if (openMatch) {
              const name = openMatch[1]
              const rest = buffer.slice(emittedIdx + (openMatch.index ?? 0))
              const pathM = rest.match(/<path>([^<]+?)<\/path>/i)
              const urlM = rest.match(/<url>([^<]+?)<\/url>/i)
              const qM = rest.match(/<query>([^<]+?)<\/query>/i)
              const cmdM = rest.match(/<command>([^<\n]+)/i)
              pendingAction = {
                name,
                target: pathM?.[1] || urlM?.[1] || qM?.[1] || cmdM?.[1]
              }
            }
          } else if (!pendingAction.target) {
            const rest = buffer.slice(emittedIdx)
            const pathM = rest.match(/<path>([^<]+?)<\/path>/i)
            const urlM = rest.match(/<url>([^<]+?)<\/url>/i)
            const qM = rest.match(/<query>([^<]+?)<\/query>/i)
            const cmdM = rest.match(/<command>([^<\n]+)/i)
            const t = pathM?.[1] || urlM?.[1] || qM?.[1] || cmdM?.[1]
            if (t) pendingAction.target = t
          }

          // Live write_file streaming — create/update the file as <content> grows
          if (pendingAction?.name === 'write_file' && pendingAction.target && !livePath) {
            livePath = pendingAction.target
          }
          if (livePath && liveContentStart < 0) {
            const idx = buffer.indexOf('<content>')
            if (idx >= 0) liveContentStart = idx + '<content>'.length
          }
          if (livePath && liveContentStart >= 0) {
            const now = Date.now()
            if (now - lastLiveWrite > 450) {
              lastLiveWrite = now
              writeLivePartial()
            }
          }

          emitActivity()

          let parseIters = 0
          while (true) {
            if (++parseIters > 64) break // safety against malformed model output causing parse loops
            if (!useTools) {
              // No tool parsing: stream tokens as they arrive
              if (emittedIdx < buffer.length) {
                emit({ type: 'token', text: buffer.slice(emittedIdx) })
                emittedIdx = buffer.length
              }
              break
            }

            const found = findNextAction(buffer, emittedIdx)

            if (found === null) {
              // No action starting in the remaining buffer: emit safe text
              const safe = emitSafeBoundary(buffer, emittedIdx)
              if (safe > emittedIdx) {
                emit({ type: 'token', text: buffer.slice(emittedIdx, safe) })
                emittedIdx = safe
              }
              break
            }

            if (found === 'incomplete') {
              // Action has started but not closed. Emit text up to the open tag.
              const openIdx = buffer.indexOf('<action', emittedIdx)
              if (openIdx > emittedIdx) {
                emit({ type: 'token', text: buffer.slice(emittedIdx, openIdx) })
                emittedIdx = openIdx
              }
              break
            }

            // Emit any text between last emit and action start
            if (found.start > emittedIdx) {
              emit({ type: 'token', text: buffer.slice(emittedIdx, found.start) })
            }
            emittedIdx = found.end

            const call: ToolCall = {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: found.name,
              args: found.args,
              running: true
            }
            emit({ type: 'tool_call', call })
            emit({
              type: 'activity',
              activity: { kind: 'tool', tool: found.name, target: actionTarget(found.name, found.args) }
            })

            let result: string
            let hadError = false
            try {
              result = await runTool(found.name, found.args, ctx)
              emit({ type: 'tool_result', id: call.id, result })
            } catch (e) {
              result = `Error: ${(e as Error).message}`
              hadError = true
              emit({ type: 'tool_result', id: call.id, error: result })
            }

            baseMessages.push({ role: 'assistant', content: buffer.slice(0, emittedIdx) })
            baseMessages.push({
              role: 'tool',
              content: `[${hadError ? 'error' : 'ok'}] ${found.name}: ${result}`
            })
            executedAction = true
            if (livePath) {
              send('file:streaming', {
                conversationId: req.conversationId,
                path: livePath,
                content: lastEmittedContent,
                done: true
              })
            }
            pendingAction = null
            livePath = null
            liveContentStart = -1
            lastEmittedContent = ''
            emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })
            // Break out of the current stream — we need to start a new
            // request with the updated conversation including the tool result.
            break streamLoop
          }
        }
        if (chunk.done) {
          break streamLoop
        }
      }

      if (!executedAction && useTools) {
        const partial = parsePartialWriteFile(buffer)
        if (partial) {
          const call: ToolCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: 'write_file',
            args: partial,
            running: true
          }
          emit({ type: 'tool_call', call })
          emit({
            type: 'activity',
            activity: { kind: 'tool', tool: 'write_file', target: partial.path }
          })

          let result: string
          let hadError = false
          try {
            result = await runTool('write_file', partial, ctx)
            emit({ type: 'tool_result', id: call.id, result })
          } catch (e) {
            result = `Error: ${(e as Error).message}`
            hadError = true
            emit({ type: 'tool_result', id: call.id, error: result })
          }

          baseMessages.push({ role: 'assistant', content: buffer })
          baseMessages.push({
            role: 'tool',
            content: `[${hadError ? 'error' : 'ok'}] write_file: ${result}`
          })
          executedAction = true
          emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })
          continue
        }
      }

      if (!executedAction) {
        // In Build mode, if the model just described a plan without writing code,
        // nudge it to start coding immediately instead of ending the turn.
        if (req.mode === 'code' && round === 0 && buffer.trim().length > 0) {
          // Flush the plan text to the UI
          if (emittedIdx < buffer.length) {
            emit({ type: 'token', text: buffer.slice(emittedIdx) })
          }
          baseMessages.push({ role: 'assistant', content: buffer })
          baseMessages.push({
            role: 'user',
            content:
              'Good plan. Now start building — emit a write_file action with the first file immediately.'
          })
          emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })
          continue // go to round 1
        }
        emit({ type: 'activity', activity: { kind: 'idle' } })
        emit({ type: 'done' })
        return
      }
    }
    emit({ type: 'activity', activity: { kind: 'idle' } })
    emit({
      type: 'error',
      error: `Reached max tool rounds (${maxRounds}). Ask the model to finish up and try again.`
    })
  } catch (e) {
    emit({ type: 'activity', activity: { kind: 'idle' } })
    if ((e as Error).name === 'AbortError') {
      emit({ type: 'done' })
    } else {
      emit({ type: 'error', error: (e as Error).message })
    }
  } finally {
    // Stop monitoring when done
    if (cpuUpdateInterval) clearInterval(cpuUpdateInterval)
    chatAbortControllers.delete(req.conversationId)
  }
}

const chatAbortControllers = new Map<string, AbortController>()

app.whenReady().then(async () => {
  if (process.platform === 'win32' && !app.isPackaged) app.setAppUserModelId(process.execPath)
  else if (process.platform === 'win32') app.setAppUserModelId('com.ammaar.gemmachat')
  nativeTheme.themeSource = 'dark'

  // Set dock icon (macOS) — ensures the Gemma icon shows in dev mode
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }

  app.on('browser-window-created', (_, window) => {
    // Allow F12 devtools in dev mode
    if (!app.isPackaged) window.webContents.on('before-input-event', (_, input) => {
      if (input.key === 'F12') window.webContents.openDevTools()
    })
  })

  await startWorkspaceServer()

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true)
      return
    }
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  ipcMain.handle('setup:start', async (_e, modelConfig: ModelConfig) => {
    const key = `setup:${modelConfig.source}:${modelConfig.model ?? modelConfig.path ?? ''}`
    await singleflightModelLoad(key, () => handleSetup(modelConfig))
  })

  ipcMain.handle('model:switch', async (_e, modelConfig: ModelConfig) => {
    const key = `switch:${modelConfig.source}:${modelConfig.model ?? modelConfig.path ?? ''}`
    await singleflightModelLoad(key, async () => {
      const label = modelConfig.source === 'mlx'
        ? AVAILABLE_MODELS.find((m) => m.name === modelConfig.model)?.label
        : 'Local GGUF'

      // The renderer disables model switching while a response is streaming,
      // but abort any in-flight generation anyway (defense in depth) so a
      // switch triggered another way never leaves a chat mid-stream when the
      // backend it's reading from gets killed/restarted below.
      abortAll(chatAbortControllers)

      send('setup:status', {
        stage: 'downloading-model',
        message: `Switching to ${label}…`
      })

      try {
        await ensureBackendRunning(modelConfig)
        send('setup:status', { stage: 'ready', message: 'Ready to chat.' })
      } catch (e) {
        send('setup:status', {
          stage: 'error',
          message: 'Model switch failed',
          error: (e as Error).message
        })
      }
    })
  })

  ipcMain.handle('setup:status', async () => {
    const backend = getCurrentBackend()
    const isReady = backend ? await backend.isReady() : false
    if (isReady) return { hasMLX: true }

    const mlx = locateMLX()
    return { hasMLX: Boolean(mlx?.installed) }
  })

  ipcMain.handle('models:list-local', async () => {
    const backend = getCurrentBackend()
    if (!backend) {
      return listCachedModels()
    }
    return await backend.listModels()
  })

  ipcMain.handle('ollama:check', async () => {
    return { running: await isOllamaRunning() }
  })

  ipcMain.handle('ollama:list-models', async () => {
    const entries = await listOllamaModels()
    return entries.map(ollamaModelToInfo)
  })

  ipcMain.handle('chat:send', async (_e, req: ChatRequest) => {
    const channel = `chat:stream:${req.conversationId}`
    handleChat(req, channel).catch((err) => console.error('chat handler error', err))
    return { channel }
  })

  ipcMain.handle('chat:abort', async (_e, conversationId: string) => {
    const c = chatAbortControllers.get(conversationId)
    if (c) c.abort()
  })

  ipcMain.handle('prompt:enhance', async (_e, req: EnhancePromptRequest) => {
    const backend = getCurrentBackend()
    if (!backend) throw new Error('No inference backend available.')
    let out = ''
    for await (const chunk of backend.chat({
      model: req.model,
      messages: [
        { role: 'system', content: enhancePromptSystem() },
        { role: 'user', content: req.text }
      ],
      temperature: 0.4
    })) {
      if (chunk.content) out += chunk.content
    }
    return { text: out.trim() }
  })

  ipcMain.handle('tools:list', async () => {
    return Object.values(TOOLS).map((t) => ({
      name: t.name,
      description: t.description,
      mode: t.mode
    }))
  })

  ipcMain.handle('workspace:info', async (_e, conversationId: string) => {
    await ensureWorkspace(conversationId)
    return {
      conversationId,
      path: workspaceDir(conversationId),
      previewUrl: previewUrl(conversationId)
    }
  })

  ipcMain.handle('workspace:list', async (_e, conversationId: string) => {
    const base = await ensureWorkspace(conversationId)
    return listTree(base, 300)
  })

  ipcMain.handle('workspace:open-external', async (_e, conversationId: string) => {
    await ensureWorkspace(conversationId)
    shell.openPath(workspaceDir(conversationId))
  })

  ipcMain.handle('workspace:server-port', async () => getWorkspaceServerPort())

  ipcMain.handle(
    'audio:transcribe',
    async (_e, { base64: _base64, model: _model }: { base64: string; model: string }) => {
      // Audio transcription via MLX is not yet supported
      // Return empty text so the UI doesn't break
      return { text: '' }
    }
  )

  ipcMain.handle('dialog:open-file', async (_e, options) => {
    if (!mainWindow) {
      throw new Error('Main window not available')
    }

    return dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
    })
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep the app alive in the dock so reopening is instant and the
  // MLX subprocess + workspace server stay warm. Only non-darwin platforms
  // quit on last-window-close.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  shutdownBackend()
  stopWorkspaceServer()
})
