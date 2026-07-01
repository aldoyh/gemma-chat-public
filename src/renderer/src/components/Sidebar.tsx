import type { ModelConfig } from '@shared/types'

interface Conversation {
  id: string
  title: string
  createdAt: number
  messages?: Array<unknown>
  mode?: 'chat' | 'code'
}

interface Props {
  conversations: Conversation[]
  activeId: string
  modelConfig: ModelConfig
  collapsed?: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onToggleCollapsed?: () => void
}

export default function Sidebar({
  conversations,
  activeId,
  modelConfig,
  collapsed = false,
  onSelect,
  onNew,
  onDelete,
  onToggleCollapsed
}: Props) {
  const badgeColor =
    modelConfig.source === 'ollama' ? 'bg-emerald-400' :
    modelConfig.source === 'mlx' ? 'bg-blue-400' : 'bg-orange-400'

  const badgeLabel =
    modelConfig.source === 'ollama' ? 'Ollama' :
    modelConfig.source === 'mlx' ? 'MLX' : 'GGUF'

  return (
    <div
      className={`drag flex h-full shrink-0 flex-col border-r border-white/[0.08] bg-black/30 transition-[width] duration-200 backdrop-blur-xl ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      <div className={`flex h-11 shrink-0 items-center px-2 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              {collapsed ? (
                <path d="M6 4l4 4-4 4M3 4v8" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M10 4l-4 4 4 4M13 4v8" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        )}
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="hero-glow flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-[10px] font-semibold tracking-[0.18em] text-white">
              G
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-ink-400">Gemma Chat</div>
              <div className="text-[10px] text-ink-500">Local workspace</div>
            </div>
          </div>
        )}
      </div>

      <div className="no-drag px-2 pb-3">
        <button
          onClick={onNew}
          title="New chat"
          aria-label="New chat"
          className={`flex w-full items-center rounded-lg border border-white/10 bg-white/[0.05] text-[13px] font-medium text-white transition hover:border-white/20 hover:bg-white/[0.08] ${
            collapsed ? 'h-9 justify-center' : 'justify-center gap-2 px-3 py-2'
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          {!collapsed && <span>New chat</span>}
        </button>
      </div>

      <div className="no-drag min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {conversations.map((c) => (
          <div key={c.id} className="group relative">
            <button
              onClick={() => onSelect(c.id)}
              title={collapsed ? c.title : undefined}
              className={`w-full truncate rounded-xl text-left text-[13px] transition-all duration-200 ease-out ${
                collapsed ? 'mx-auto mb-1 flex h-9 w-9 items-center justify-center px-0' : 'px-3 py-2.5'
              } ${
                activeId === c.id
                  ? 'border border-white/10 bg-white/[0.08] text-white shadow-[0_14px_30px_rgba(0,0,0,0.24)]'
                  : 'border border-transparent bg-transparent text-ink-200 hover:border-white/5 hover:bg-white/[0.035]'
              }`}
            >
              {collapsed ? (
                <span className="text-[11px] font-semibold uppercase">
                  {initials(c.title)}
                </span>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.title}</span>
                    {activeId === c.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex items-center gap-2 text-[10.5px] text-ink-400">
                    <span>{c.messages?.length ?? 0} msgs</span>
                    <span className="h-1 w-1 rounded-full bg-white/25" />
                    <span>{c.mode === 'code' ? 'Build' : 'Chat'}</span>
                  </div>
                </div>
              )}
            </button>
            {!collapsed && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('Delete this chat?')) onDelete(c.id)
                }}
                className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-ink-400 hover:bg-white/10 hover:text-white group-hover:flex"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                  <path d="M4 4l8 8M12 4L4 12" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className={`no-drag border-t border-white/[0.06] text-[11px] text-ink-400 ${collapsed ? 'p-2' : 'p-3'}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <span title={`${badgeLabel} backend`} className={`inline-block h-2 w-2 rounded-full ${badgeColor}`} />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${badgeColor}`} />
              <span>{badgeLabel}</span>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <span className="text-ink-500">Private</span>
            </div>
            <div className="flex items-center gap-1 text-ink-400/50">
              <span>Original by</span>
              <a
                href="https://x.com/ammaar"
                target="_blank"
                rel="noopener noreferrer"
                className="transition hover:text-ink-200"
              >
                @ammaar
              </a>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <span>Remix by</span>
              <a
                href="https://github.com/aldoyh/gemma-chat-public"
                target="_blank"
                rel="noopener noreferrer"
                className="transition hover:text-ink-200"
              >
                @aldoyh
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function initials(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '·'
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
