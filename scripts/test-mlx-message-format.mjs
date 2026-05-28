import assert from 'node:assert/strict'
import { formatMessagesForMLX } from '../dist-test/message-format.mjs'

console.log('Running updated MLX message format test (post-fix expectations)...')

const formatted = formatMessagesForMLX([
  { role: 'system', content: 'You are concise.' },
  { role: 'user', content: 'What is 2+2?' },
  { role: 'assistant', content: '4' },
  { role: 'tool', content: '[ok] calculator: 4' },
  { role: 'user', content: 'Say it as a word.' }
])

// After the fix we intentionally preserve a leading system role (better for Gemma)
assert.deepEqual(
  formatted.map((m) => m.role),
  ['system', 'user', 'assistant', 'user'],
  'Leading system should be preserved; then user/assistant alternation'
)

assert.ok(
  formatted[0].content.includes('You are concise.'),
  'Leading system content must be passed through cleanly to the model'
)

assert.match(
  formatted[formatted.length - 1].content,
  /Tool result:\n\[ok\] calculator: 4\n\nSay it as a word\./,
  'tool results should be folded into the next user turn'
)

assert.equal(
  formatted.some((m) => m.role === 'tool'),
  false,
  'MLX server should never receive raw tool roles'
)

console.log('mlx message format tests passed (new correct behavior)')
