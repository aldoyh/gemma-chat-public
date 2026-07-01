import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AVAILABLE_MODELS, type AgentMode, type ChatMessage, type ToolCall, type StreamChunk, type ActivityState, type ModelConfig, type OllamaModelInfo } from '@shared/types'
import Composer from './Composer'
import Message from './Message'
import Sidebar from './Sidebar'
import Canvas from './Canvas'
import ActivityIndicator from './ActivityIndicator'
import { useBreakpoint } from '../lib/useViewport'

interface Props {
  modelConfig: ModelConfig
  onSwitchModel: (config: ModelConfig) => void
  onActivityChange?: (state: ActivityState) => void
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  mode: AgentMode
  canvasOpen?: boolean
}

const STORAGE_KEY = 'gemma-chat:conversations:v2'
const SIDEBAR_KEY = 'gemma-chat:sidebar-collapsed'

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Conversation[]
    return arr.map((c) => ({ ...c, mode: c.mode ?? 'chat' }))
  } catch {
    return []
  }
}

function saveConversations(cs: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cs))
  } catch {
    // ignore
  }
}

function newConversation(mode: AgentMode = 'chat'): Conversation {
  return {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: 'New chat',
    messages: [],
    createdAt: Date.now(),
    mode,
    canvasOpen: mode === 'code'
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export default function Chat({ modelConfig, onSwitchModel, onActivityChange }: Props) {
  const isWide = useBreakpoint('xl') ?? true
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations()
    return loaded.length ? loaded : [newConversation()]
  })
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id)
  const [streaming, setStreaming] = useState(false)
  const [activityState, setActivityState] = useState<ActivityState>('idle')
  const [cpuPercent] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const [messageHistory, setMessageHistory] = useState<string[]>([])
  const streamRef = useRef<{ abort: boolean }>({ abort: false })

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [sidebarCollapsed])

  // Extract model name for API calls
  const modelName =
    modelConfig.source === 'mlx' ? (modelConfig.model || 'unknown') :
    modelConfig.source === 'ollama' ? (modelConfig.model || 'unknown') :
    (modelConfig.path || 'custom')

  // Notify parent when activity state changes
  useEffect(() => {
    onActivityChange?.(activityState)
  }, [activityState, onActivityChange])

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId]
  )
  const messageCount = activeConversation.messages.length

  useEffect(() => {
    saveConversations(conversations)
  }, [conversations])

  function updateActive(fn: (c: Conversation) => Conversation): void {
    setConversations((cs) => cs.map((c) => (c.id === activeId ? fn(c) : c)))
  }

  function createConversation(mode: AgentMode = 'chat'): void {
    const c = newConversation(mode)
    setConversations((cs) => [c, ...cs])
    setActiveId(c.id)
    setMessageHistory([])
  }

  function deleteConversation(id: string): void {
    setConversations((cs) => {
      const filtered = cs.filter((c) => c.id !== id)
      if (filtered.length === 0) {
        const nc = newConversation()
        setActiveId(nc.id)
        return [nc]
      }
      if (id === activeId) setActiveId(filtered[0].id)
      return filtered
    })
  }

  function toggleMode(): void {
    updateActive((c) => {
      const nextMode: AgentMode = c.mode === 'code' ? 'chat' : 'code'
      return { ...c, mode: nextMode, canvasOpen: nextMode === 'code' }
    })
  }

  function toggleCanvas(): void {
    updateActive((c) => ({ ...c, canvasOpen: !c.canvasOpen }))
  }

  async function handleSend(input: string): Promise<void> {
    if (!input.trim() || streaming) return

    const conv = conversations.find((c) => c.id === activeId)!

    const userMsg: ChatMessage = {
      id: newId('m'),
      role: 'user',
      content: input,
      createdAt: Date.now()
    }
    const assistantMsg: ChatMessage = {
      id: newId('m'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: modelName,
      toolCalls: [],
      activity: { kind: 'thinking' }
    }

    updateActive((c) => {
      const title =
        c.messages.length === 0
          ? input.slice(0, 48) + (input.length > 48 ? '…' : '')
          : c.title
      return { ...c, title, messages: [...c.messages, userMsg, assistantMsg] }
    })

    setMessageHistory((prev) => [...prev, input])

    const history = [...conv.messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls
    }))

    setStreaming(true)
    setActivityState('thinking')
    streamRef.current.abort = false

    try {
      await window.api.sendChat(
        {
          conversationId: activeId,
          messages: history,
          model: modelName,
          enableTools: conv.mode === 'code',
          mode: conv.mode
        },
        (chunk: StreamChunk) => {
          if (streamRef.current.abort) return
          setConversations((cs) =>
            cs.map((c) => {
              if (c.id !== activeId) return c
              const msgs = [...c.messages]
              const last = msgs[msgs.length - 1]
              if (!last || last.role !== 'assistant') return c
              if (chunk.type === 'token') {
                msgs[msgs.length - 1] = { ...last, content: last.content + chunk.text }
                setActivityState('generating')
              } else if (chunk.type === 'tool_call') {
                const tc: ToolCall = { ...chunk.call, running: true }
                msgs[msgs.length - 1] = {
                  ...last,
                  toolCalls: [...(last.toolCalls ?? []), tc]
                }
              } else if (chunk.type === 'tool_result') {
                const tcs = (last.toolCalls ?? []).map((t) =>
                  t.id === chunk.id
                    ? { ...t, running: false, result: chunk.result, error: chunk.error }
                    : t
                )
                msgs[msgs.length - 1] = { ...last, toolCalls: tcs }
              } else if (chunk.type === 'activity') {
                msgs[msgs.length - 1] = { ...last, activity: chunk.activity }
                if (chunk.activity.kind === 'thinking') {
                  setActivityState('thinking')
                } else if (chunk.activity.kind === 'generating') {
                  setActivityState('generating')
                }
              } else if (chunk.type === 'done') {
                msgs[msgs.length - 1] = { ...last, done: true, activity: { kind: 'idle' } }
                setActivityState('idle')
              } else if (chunk.type === 'error') {
                msgs[msgs.length - 1] = {
                  ...last,
                  done: true,
                  activity: { kind: 'idle' },
                  content:
                    last.content + (last.content ? '\n\n' : '') + `⚠️ ${chunk.error}`
                }
                setActivityState('idle')
              }
              return { ...c, messages: msgs }
            })
          )
        }
      )
    } finally {
      setStreaming(false)
      setActivityState('idle')
    }
  }

  async function handleStop(): Promise<void> {
    streamRef.current.abort = true
    await window.api.abortChat(activeId)
    setStreaming(false)
  }

  async function handleRegenerate(): Promise<void> {
    if (streaming) return
    const conv = conversations.find((c) => c.id === activeId)
    if (!conv) return
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    updateActive((c) => {
      const msgs = [...c.messages]
      while (msgs.length && msgs[msgs.length - 1].role !== 'user') {
        msgs.pop()
      }
      return { ...c, messages: msgs.slice(0, -1) }
    })
    setTimeout(() => handleSend(lastUser.content), 0)
  }

  const canvasVisible =
    (activeConversation.mode === 'code' || activeConversation.canvasOpen === true) &&
    activeConversation.canvasOpen !== false

  return (
    <div className="flex h-full w-full">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        modelConfig={modelConfig}
        collapsed={sidebarCollapsed}
        onSelect={(id) => {
          setActiveId(id)
          setMessageHistory(conversations.find((c) => c.id === id)?.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.content) || [])
        }}
        onNew={() => createConversation(activeConversation.mode)}
        onDelete={deleteConversation}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            modelConfig={modelConfig}
            mode={activeConversation.mode}
            canvasOpen={!!activeConversation.canvasOpen}
            conversationTitle={activeConversation.title}
            messageCount={messageCount}
            onToggleMode={toggleMode}
            onToggleCanvas={toggleCanvas}
            onSwitchModel={onSwitchModel}
            activityState={activityState}
            cpuPercent={cpuPercent}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          />
          <MessageList
            messages={activeConversation.messages}
            streaming={streaming}
            mode={activeConversation.mode}
            onRegenerate={handleRegenerate}
            onQuickPrompt={handleSend}
          />
          <Composer
            onSend={handleSend}
            onStop={handleStop}
            streaming={streaming}
            disabled={false}
            model={modelName}
            placeholder={
              activeConversation.mode === 'code'
                ? 'Describe what to build — a webpage, component, or script…'
                : 'Message Gemma…'
            }
            history={messageHistory}
          />
        </div>
        {canvasVisible && isWide && (
          <ResizableCanvas
            conversationId={activeId}
            streaming={streaming}
            onClose={() => updateActive((c) => ({ ...c, canvasOpen: false }))}
          />
        )}
        {canvasVisible && !isWide && (
          <CanvasOverlay
            conversationId={activeId}
            streaming={streaming}
            onClose={() => updateActive((c) => ({ ...c, canvasOpen: false }))}
          />
        )}
      </div>
    </div>
  )
}

function ResizableCanvas({
  conversationId,
  streaming,
  onClose
}: {
  conversationId: string
  streaming: boolean
  onClose: () => void
}) {
  const [width, setWidth] = useState(520)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = width
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const delta = startX.current - e.clientX
    const next = Math.max(280, Math.min(startW.current + delta, Math.min(900, window.innerWidth - 480)))
    setWidth(next)
  }, [])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  return (
    <div
      className="anim-slide-right relative shrink-0"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize select-none transition-colors hover:bg-white/10 active:bg-white/20"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ touchAction: 'none' }}
      />
      <Canvas
        conversationId={conversationId}
        streaming={streaming}
        onClose={onClose}
      />
    </div>
  )
}

function CanvasOverlay({
  conversationId,
  streaming,
  onClose
}: {
  conversationId: string
  streaming: boolean
  onClose: () => void
}) {
  return (
    <div
      className="anim-fade-in fixed inset-0 z-40 flex items-stretch justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="anim-slide-right relative h-full w-full max-w-[640px] bg-ink-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Canvas
          conversationId={conversationId}
          streaming={streaming}
          onClose={onClose}
        />
      </div>
    </div>
  )
}

function Header({
  modelConfig,
  mode,
  canvasOpen,
  conversationTitle,
  messageCount,
  onToggleMode,
  onToggleCanvas,
  onSwitchModel,
  activityState,
  cpuPercent,
  sidebarCollapsed,
  onToggleSidebar
}: {
  modelConfig: ModelConfig
  mode: AgentMode
  canvasOpen: boolean
  conversationTitle: string
  messageCount: number
  onToggleMode: () => void
  onToggleCanvas: () => void
  onSwitchModel: (config: ModelConfig) => void
  activityState: ActivityState
  cpuPercent: number
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([])
  const pickerRef = useRef<HTMLDivElement>(null)

  // Fetch Ollama models when source is ollama
  useEffect(() => {
    if (modelConfig.source !== 'ollama') return
    window.api.listOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]))
  }, [modelConfig.source])

  // Close dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return
    function handleClick(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerOpen])

  const displayModel = modelConfig.model ?? 'gemma-4'
  const modelLabel =
    modelConfig.source === 'ollama'
      ? (modelConfig.model || 'Ollama')
      : (AVAILABLE_MODELS.find((m) => m.name === displayModel)?.label ?? displayModel)

  const dotColor =
    modelConfig.source === 'ollama' ? 'bg-emerald-400' :
    modelConfig.source === 'mlx' ? 'bg-blue-400' : 'bg-orange-400'

  const activityLabel =
    activityState === 'thinking'
      ? 'Thinking'
      : activityState === 'generating'
        ? 'Responding'
        : activityState === 'loading'
          ? 'Loading model'
          : 'Idle'

  return (
    <div className="drag flex flex-col gap-3 border-b border-white/[0.08] bg-black/30 px-3 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="no-drag flex min-w-0 items-start gap-2">
          {sidebarCollapsed && (
            <button
              onClick={onToggleSidebar}
              title="Expand sidebar"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-white/5 hover:text-white"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 4l4 4-4 4M3 4v8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-[15px] font-semibold tracking-tight text-white sm:text-[16px]">
                {conversationTitle}
              </div>
              <span className={`hidden h-1.5 w-1.5 rounded-full sm:inline-block ${dotColor}`} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
              <span>{messageCount} message{messageCount === 1 ? '' : 's'}</span>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <span>{mode === 'code' ? 'Build workspace' : 'Chat workspace'}</span>
              <span className="hidden h-1 w-1 rounded-full bg-white/20 sm:inline-block" />
              <span className="hidden sm:inline">{activityLabel}</span>
            </div>
          </div>
        </div>

        <div className="no-drag hidden items-center gap-2 lg:flex">
          <ActivityIndicator state={activityState} cpuPercent={cpuPercent} />
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-0.5 text-[12px]">
            <ModePill active={mode === 'chat'} onClick={() => mode === 'code' && onToggleMode()}>
              Chat
            </ModePill>
            <ModePill active={mode === 'code'} onClick={() => mode === 'chat' && onToggleMode()}>
              Build
            </ModePill>
          </div>
        </div>

        <div className="no-drag flex shrink-0 items-center justify-end gap-2">
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-ink-300 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.07] hover:text-white"
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
              {modelLabel}
              <svg viewBox="0 0 16 16" className={`h-3 w-3 transition-transform duration-200 ${pickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {pickerOpen && (
              <div className="anim-fade-scale surface-panel-strong absolute right-0 top-full z-50 mt-1 w-72 rounded-[20px] p-1.5">
                <div className="mb-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                  Switch model
                </div>
                {modelConfig.source === 'ollama' ? (
                  ollamaModels.length === 0 ? (
                    <div className="px-2.5 py-2 text-[12px] text-ink-400">No Ollama models found</div>
                  ) : (
                    ollamaModels.map((m) => (
                      <button
                        key={m.name}
                        onClick={() => {
                          setPickerOpen(false)
                          if (m.name !== modelLabel) onSwitchModel({ source: 'ollama', model: m.name })
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2.5 text-left transition-all duration-150 ${
                          m.name === modelLabel
                            ? 'bg-white/[0.08] text-white'
                            : 'text-ink-200 hover:bg-white/[0.05]'
                        }`}
                      >
                        <div>
                          <div className="text-[12.5px] font-medium">{m.label || m.name}</div>
                          {m.size && <div className="mt-0.5 text-[11px] text-ink-400">{m.size}</div>}
                        </div>
                        {m.name === modelLabel && (
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ))
                  )
                ) : (
                  AVAILABLE_MODELS.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => {
                        setPickerOpen(false)
                        if (m.name !== modelLabel) onSwitchModel({ source: 'mlx', model: m.name })
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2.5 text-left transition-all duration-150 ${
                        m.name === modelLabel
                          ? 'bg-white/[0.08] text-white'
                          : 'text-ink-200 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                          {m.label}
                          {m.recommended && (
                            <span className="rounded-full bg-white/10 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-ink-200">
                              rec
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-400">{m.size}</div>
                      </div>
                      {m.name === modelLabel && (
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {mode === 'code' && (
            <button
              onClick={onToggleCanvas}
              title={canvasOpen ? 'Hide canvas' : 'Show canvas'}
              className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                canvasOpen ? 'border-white/15 bg-white/10 text-white' : 'border-white/8 bg-white/[0.03] text-ink-400 hover:border-white/15 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <path d="M9 3v10" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-ink-300">
            Local inference
          </span>
          <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-ink-300">
            Private workspace
          </span>
          <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-ink-300">
            {mode === 'code' ? 'Canvas enabled' : 'Chat only'}
          </span>
        </div>
        <span className="text-ink-500">{activityLabel}</span>
      </div>
    </div>
  )
}

function ModePill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 font-medium transition-all duration-200 ease-out ${
        active ? 'bg-white/12 text-white shadow-sm scale-[1.02]' : 'text-ink-400 hover:bg-white/[0.03] hover:text-ink-100 scale-100'
      }`}
    >
      {children}
    </button>
  )
}

function MessageList({
  messages,
  streaming,
  mode,
  onRegenerate,
  onQuickPrompt
}: {
  messages: ChatMessage[]
  streaming: boolean
  mode: AgentMode
  onRegenerate: () => void
  onQuickPrompt: (prompt: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (atBottomRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [messages])

  const empty = messages.length === 0

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      {empty ? (
        <EmptyState mode={mode} onQuickPrompt={onQuickPrompt} />
      ) : (
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-3 py-6 sm:px-6 sm:py-10">
          {messages.map((m, i) => (
            <div key={m.id} className="anim-float-in" style={{ animationDelay: `${Math.min(i * 30, 150)}ms` }}>
              <Message
                message={m}
                isLast={i === messages.length - 1}
                streaming={streaming && i === messages.length - 1}
                onRegenerate={
                  !streaming && m.role === 'assistant' && i === messages.length - 1
                    ? onRegenerate
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  mode,
  onQuickPrompt
}: {
  mode: AgentMode
  onQuickPrompt: (prompt: string) => void
}) {
  const chatSuggestions = [
    { title: 'Search the web', prompt: 'What are the top AI news stories this week?' },
    { title: 'Explain a concept', prompt: 'Explain the transformer architecture in plain English.' },
    { title: 'Plan a trip', prompt: 'Help me plan a weekend trip to Tokyo for 4 days.' },
    { title: 'Debug code', prompt: 'Why is this JS promise not resolving? (paste code)' }
  ]
  const codeSuggestions = [
    {
      title: 'Landing page',
      prompt: 'Build a one-page landing site for a fake AI dog-walking app. Modern design, dark mode.'
    },
    {
      title: 'Pomodoro timer',
      prompt: 'Build a pomodoro timer web app with start/pause/reset buttons and a minimal UI.'
    },
    {
      title: 'Retro snake game',
      prompt: 'Make a playable snake game in a single index.html with keyboard controls.'
    },
    {
      title: 'Markdown preview',
      prompt: 'Build a live markdown editor — textarea on the left, rendered output on the right.'
    }
  ]
  const suggestions = mode === 'code' ? codeSuggestions : chatSuggestions
  const intro = mode === 'code'
    ? {
        title: 'What should we build?',
        copy: 'Gemma writes files into a workspace and keeps the preview live on the right.',
        accent: 'Build mode'
      }
    : {
        title: 'How can I help?',
        copy: 'Running locally. Your messages stay on your Mac and respond in real time.',
        accent: 'Chat mode'
      }

  return (
    <div className="anim-fade-in flex h-full items-center justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-[980px]">
        <div className="surface-panel-strong anim-fade-up mb-6 overflow-hidden rounded-[32px] px-5 py-6 sm:px-8 sm:py-8">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="text-center lg:text-left">
              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-ink-300">
                {intro.accent}
              </div>
              <div className="mb-3 text-[27px] font-semibold tracking-tight text-white sm:text-[36px]">
                {intro.title}
              </div>
              <div className="mx-auto max-w-xl text-sm leading-6 text-ink-400 lg:mx-0">
                {intro.copy}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <FeaturePill title="Local" copy="No cloud handoff" />
              <FeaturePill title="Fast" copy="Optimized for quick replies" />
              <FeaturePill title="Focused" copy="Build or chat in one place" />
            </div>
          </div>
        </div>
        <div className="anim-stagger grid w-full grid-cols-1 gap-2 md:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => onQuickPrompt(s.prompt)}
            className="anim-fade-up rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/[0.14] hover:bg-white/[0.06] active:scale-[0.99]"
          >
            <div className="text-sm font-medium text-white">{s.title}</div>
            <div className="mt-1 text-[12.5px] leading-5 text-ink-400">{s.prompt}</div>
          </button>
        ))}
        </div>
      </div>
    </div>
  )
}

function FeaturePill({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-white">{title}</div>
      <div className="mt-1 text-[12px] leading-5 text-ink-400">{copy}</div>
    </div>
  )
}
