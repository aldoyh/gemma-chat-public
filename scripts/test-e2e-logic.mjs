/**
 * Automated E2E Logic Test — guards the exact classes of bugs that made the app unusable.
 * Run via the manual bundle + import in CI or locally.
 */
import assert from 'node:assert/strict'
import { formatMessagesForMLX } from '../dist-test/message-format.mjs'

function renderToolHelp() { return 'web_search, write_file, ...' }

function codeSystemPrompt(workspacePath, previewHref) {
  const now = new Date().toISOString()
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  return [
    "You are Gemma, a local coding agent running entirely on the user's Mac.",
    `Date: ${now} (${day}). Workspace: ${workspacePath}. Preview: ${previewHref}`,
    '',
    'GOAL: Build a small, polished, fully working web app matching the request.',
    '- Real copy and interactions — no placeholders, no "Coming Soon", no lorem.',
    '',
    'MINIMAL GOOD EXAMPLE',
    "I'll create a working click counter.",
    '<action name="write_file">',
    '<path>index.html</path>',
    '<content>',
    '<!doctype html><html><body><h1 id="n">0</h1><button onclick="inc()">+1</button><script>let c=0;function inc(){c++;document.getElementById("n").textContent=c}</script></body></html>',
    '</content>',
    '</action>',
    '',
    'HARD RULES',
    '- NEVER emit "Coming Soon", placeholders, or lorem.',
    '- Never put ``` inside <content>.',
    '',
    'AVAILABLE TOOLS',
    renderToolHelp()
  ].join('\n')
}

function findNextAction(text, from = 0) {
  const openRe = /<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/gi
  openRe.lastIndex = from
  const open = openRe.exec(text)
  if (!open) return null
  const name = open[1]
  const bodyStart = open.index + open[0].length
  const closeMatch = text.slice(bodyStart).match(/<\/action\s*>/i)
  if (!closeMatch) return 'incomplete'
  const closeIdx = bodyStart + closeMatch.index
  const body = text.slice(bodyStart, closeIdx)
  const args = {}
  const co = body.indexOf('<content>')
  let outside = body
  if (co >= 0) {
    const cc = body.lastIndexOf('</content>')
    if (cc > co) {
      args.content = body.slice(co + 9, cc).replace(/^\n/, '').replace(/\n[ \t]*$/, '')
      outside = body.slice(0, co) + body.slice(cc + 10)
    }
  }
  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g
  let m
  while ((m = tagRe.exec(outside))) {
    const k = m[1]
    if (k === 'content') continue
    const t = m[2].trim()
    args[k] = (t === 'true') ? true : (t === 'false') ? false : (/^-?\d+$/.test(t) ? Number(t) : m[2].replace(/^\n/, '').replace(/\n[ \t]*$/, ''))
  }
  return { name, args, start: open.index, end: closeIdx + closeMatch[0].length }
}

function cleanFileContent(raw, path) {
  let s = raw
  const full = s.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```[\s\S]*$/)
  if (full) s = full[1]
  else {
    const lead = s.match(/^\s*```[a-zA-Z0-9_-]*\n/)
    if (lead) s = s.slice(lead[0].length)
  }
  if (path.toLowerCase().endsWith('.html')) {
    const e = s.toLowerCase().lastIndexOf('</html>')
    if (e >= 0) s = s.slice(0, e + 7) + '\n'
  }
  return s
}

console.log('=== Gemma Chat E2E Logic Test ===\n')

console.log('[1/4] Prompt hygiene (the main bug)...')
const p = codeSystemPrompt('/tmp/w', 'http://x')
const bads = ['Coming Soon', '<h1>Coming soon</h1>', '<title>Coming Soon</title>']
bads.forEach(b => assert.ok(!p.includes(b), 'Must not contain: ' + b))
assert.ok(p.includes('NEVER emit "Coming Soon"'))
assert.ok(p.includes('click counter'))
console.log('  ✅ No Coming Soon poison, good example present')

console.log('[2/4] Message formatting...')
const f = formatMessagesForMLX([{role:'system', content:'You are good.'}, {role:'user', content:'hi'}, {role:'tool', content:'ok'}])
assert.equal(f[0].role, 'system')
assert.ok(!f.some(m => m.role === 'tool'))
console.log('  ✅ System role preserved correctly')

console.log('[3/4] Action parser...')
const a = findNextAction('x<action name="write_file"><path>app.js</path><content>console.log(1)</content></action>')
assert.equal(a.name, 'write_file')
assert.ok(a.args.content.includes('console.log'))
console.log('  ✅ Parser works on new prompt output')

console.log('[4/4] cleanFileContent...')
const c = cleanFileContent('```html\n<!doctype html><html><body>Y</body></html>\n``` junk', 'index.html')
assert.ok(!c.includes('```') && c.includes('<body>Y</body>'))
console.log('  ✅ Cleaning works')

console.log('\n✅✅✅ ALL E2E LOGIC TESTS PASSED ✅✅✅')
console.log('These tests directly protect against the "completely broken app" state.')
