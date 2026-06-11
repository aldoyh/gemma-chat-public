export type InferenceChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

export type MLXCompatibleMessage = {
  role: 'user' | 'assistant'
  content: string
}

function appendMessage(
  messages: MLXCompatibleMessage[],
  role: MLXCompatibleMessage['role'],
  content: string
): void {
  const trimmed = content.trim()
  if (!trimmed) return

  const last = messages[messages.length - 1]
  if (last?.role === role) {
    last.content = `${last.content}\n\n${trimmed}`
    return
  }

  messages.push({ role, content: trimmed })
}

/**
 * Gemma chat templates used by mlx_lm reject OpenAI-style system/tool roles
 * and require strict user/assistant alternation. The server returns HTTP 404
 * with `{"error": "System role not supported"}` if a system role is sent.
 *
 * We fold any system / tool messages into the first user turn so the model
 * still sees the instructions but the wire format stays valid.
 */
export function formatMessagesForMLX(
  messages: InferenceChatMessage[]
): MLXCompatibleMessage[] {
  const formatted: MLXCompatibleMessage[] = []
  let pendingUserContent: string[] = []

  for (const message of messages) {
    const content = message.content.trim()
    if (!content) continue

    if (message.role === 'system') {
      pendingUserContent.push(`System instructions:\n${content}`)
      continue
    }

    if (message.role === 'tool') {
      pendingUserContent.push(`Tool result:\n${content}`)
      continue
    }

    if (message.role === 'user') {
      pendingUserContent.push(content)
      appendMessage(formatted, 'user', pendingUserContent.join('\n\n'))
      pendingUserContent = []
      continue
    }

    if (pendingUserContent.length > 0) {
      appendMessage(formatted, 'user', pendingUserContent.join('\n\n'))
      pendingUserContent = []
    }
    appendMessage(formatted, 'assistant', content)
  }

  if (pendingUserContent.length > 0) {
    appendMessage(formatted, 'user', pendingUserContent.join('\n\n'))
  }

  return formatted
}
