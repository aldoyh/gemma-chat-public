import assert from 'node:assert/strict'
import { formatMessagesForMLX } from '../dist-test/message-format.mjs'

const formatted = formatMessagesForMLX([
  { role: 'system', content: 'You are concise.' },
  { role: 'user', content: 'What is 2+2?' },
  { role: 'assistant', content: '4' },
  { role: 'tool', content: '[ok] calculator: 4' },
  { role: 'user', content: 'Say it as a word.' }
])

assert.deepEqual(
  formatted.map((m) => m.role),
  ['user', 'assistant', 'user'],
  'Gemma chat messages must start with user and alternate user/assistant'
)

assert.match(
  formatted[0].content,
  /System instructions:\nYou are concise\.\n\nWhat is 2\+2\?/,
  'leading system instructions should be folded into the first user turn'
)

assert.match(
  formatted[2].content,
  /Tool result:\n\[ok\] calculator: 4\n\nSay it as a word\./,
  'tool results should be folded into the next user turn'
)

assert.equal(
  formatted.some((m) => m.role === 'system' || m.role === 'tool'),
  false,
  'MLX server should never receive unsupported system/tool roles'
)

console.log('mlx message format tests passed')
