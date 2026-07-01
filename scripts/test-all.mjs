#!/usr/bin/env node
/**
 * test:all — consolidated automated test suite.
 *
 * Tests the actual source code in src/main, not copies. Each test bundle is
 * built fresh with esbuild (small, fast) into dist-test, then asserted on
 * with node:assert. No external test runner needed.
 *
 * Sections:
 *   1. message-format       (formatMessagesForMLX)
 *   2. action parser        (findNextAction + parseActionBody)
 *   3. file content cleaner (cleanFileContent)
 *   4. html asset repair    (ensureHtmlAssetReferences)
 *   5. write_file args      (getWriteFileContent)
 *   6. prompt hygiene       (no "Coming Soon" poison, real example present)
 *   7. model registry       (12B included, sizes plausible, no duplicate names)
 */
import { build } from 'esbuild'
import { rm, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import assert from 'node:assert/strict'

const DIST = 'dist-test'
const TS = 'src/main'

async function bundle(label, entry, outFile) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(DIST, outFile),
    logLevel: 'silent',
    // Stub the `electron` import so tools.ts (which transitively imports
    // workspace.ts → electron) can be loaded in plain Node. The test code
    // never invokes any of the workspace tools, so this is safe.
    alias: { electron: new URL('./fixtures/electron-stub.mjs', import.meta.url).pathname }
  })
  return import(`../${DIST}/${outFile}`)
}

const ok = (msg) => console.log(`  ✓ ${msg}`)

async function main() {
  console.log('── Gemma Chat test suite ─────────────────────')
  console.log('  bundling…')
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })

  // Bundles — keep them small and dependency-free where possible.
  // tools.ts imports workspace.ts which imports electron, so we go through
  // test-support/pure.ts which re-exports only the pure helpers.
  const fmt = await bundle('message-format', `${TS}/inference/message-format.ts`, 'message-format.mjs')
  const tools = await bundle('tools', `${TS}/test-support/pure.ts`, 'tools.mjs')
  const html = await bundle('html-assets', `${TS}/html-assets.ts`, 'html-assets.mjs')
  const wfa = await bundle('write-file-args', `${TS}/write-file-args.ts`, 'write-file-args.mjs')

  let passed = 0
  const test = (name, fn) => {
    try {
      fn()
      ok(name)
      passed++
    } catch (e) {
      console.error(`  ✗ ${name}`)
      console.error(`    ${e.message}`)
      process.exitCode = 1
    }
  }

  console.log('\n[1/7] message-format')
  test('folds system into the first user turn', () => {
    const out = fmt.formatMessagesForMLX([
      { role: 'system', content: 'You are concise.' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' }
    ])
    // MLX server rejects system role with HTTP 404. The formatter must
    // never emit one; instead the system prompt is folded into the first
    // user message under a "System instructions:" prefix.
    assert.equal(out.some((m) => m.role === 'system'), false)
    assert.equal(out[0].role, 'user')
    assert.match(out[0].content, /System instructions:\nYou are concise\./)
    assert.match(out[0].content, /What is 2\+2\?/)
    assert.equal(out[1].role, 'assistant')
    assert.equal(out[1].content, '4')
  })
  test('folds tool results into the next user turn', () => {
    const out = fmt.formatMessagesForMLX([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Q1' },
      { role: 'tool', content: '[ok] calc: 4' },
      { role: 'user', content: 'Q2' }
    ])
    assert.equal(out.some((m) => m.role === 'tool'), false, 'tool role must not leak to MLX')
    assert.match(out.at(-1).content, /Tool result:\n\[ok\] calc: 4/)
    assert.match(out.at(-1).content, /Q2/)
  })
  test('strict user/assistant alternation', () => {
    const out = fmt.formatMessagesForMLX([
      { role: 'user', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'assistant', content: 'C' }
    ])
    assert.deepEqual(out.map((m) => m.role), ['user', 'assistant'])
    assert.match(out[0].content, /A.*B/s)
  })

  console.log('\n[2/7] action parser (findNextAction)')
  test('parses simple action', () => {
    const r = tools.findNextAction(
      'x<action name="write_file"><path>app.js</path><content>console.log(1)</content></action>'
    )
    assert.equal(r.name, 'write_file')
    assert.equal(r.args.path, 'app.js')
    assert.equal(r.args.content, 'console.log(1)')
  })
  test('parses single-quoted name and tolerates spaces', () => {
    const r = tools.findNextAction(
      "x<action name = 'calc' ><expression>1+1</expression></action>"
    )
    assert.equal(r.name, 'calc')
    assert.equal(r.args.expression, '1+1')
  })
  test('returns null when no action present', () => {
    assert.equal(tools.findNextAction('plain text'), null)
  })
  test('returns "incomplete" for unclosed actions', () => {
    assert.equal(tools.findNextAction('<action name="x"><p>v'), 'incomplete')
  })
  test('parses typed args (bool, number, string)', () => {
    const r = tools.findNextAction(
      '<action name="edit_file"><path>a.txt</path><replace_all>true</replace_all><count>3</count><note>hi</note></action>'
    )
    assert.equal(r.args.replace_all, true)
    assert.equal(r.args.count, 3)
    assert.equal(r.args.note, 'hi')
  })
  test('finds next action after emitted text', () => {
    const r = tools.findNextAction(
      'first text<action name="web_search"><query>q</query></action> tail',
      5
    )
    assert.equal(r.name, 'web_search')
    assert.equal(r.args.query, 'q')
  })

  console.log('\n[3/7] cleanFileContent')
  test('strips ```lang fences', () => {
    const out = tools.cleanFileContent('```html\n<!doctype html><body>x</body>\n``` junk', 'index.html')
    assert.ok(!out.includes('```'))
    assert.ok(out.includes('<!doctype html>'))
  })
  test('truncates at </html> for .html files', () => {
    const out = tools.cleanFileContent(
      '<!doctype html><html><body>x</body></html> trailing junk about cats',
      'index.html'
    )
    assert.ok(out.endsWith('</html>\n'))
    assert.ok(!out.includes('trailing junk'))
  })
  test('truncates at </svg> for .svg files', () => {
    const out = tools.cleanFileContent('<svg>x</svg> more junk', 'icon.svg')
    assert.ok(out.endsWith('</svg>\n'))
  })
  test('truncates CSS at last rule end', () => {
    const out = tools.cleanFileContent('a{color:red}\nb{color:blue} more', 'style.css')
    assert.equal(out.trim(), 'a{color:red}\nb{color:blue}')
  })

  console.log('\n[4/7] html asset repair')
  test('injects missing stylesheet + script', () => {
    const repaired = html.ensureHtmlAssetReferences(
      '<!doctype html><html><head></head><body></body></html>',
      { stylesheet: 'style.css', script: 'app.js' }
    )
    assert.match(repaired, /<link rel="stylesheet" href="style\.css">/)
    assert.match(repaired, /<script src="app\.js" defer><\/script>/)
  })
  test('is idempotent', () => {
    const once = html.ensureHtmlAssetReferences(
      '<!doctype html><html><head></head><body></body></html>',
      { stylesheet: 'style.css', script: 'app.js' }
    )
    const twice = html.ensureHtmlAssetReferences(once, { stylesheet: 'style.css', script: 'app.js' })
    assert.equal(twice, once)
  })
  test('does not double-inject when href/src already present', () => {
    const before =
      '<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>'
    const after = html.ensureHtmlAssetReferences(before, { stylesheet: 'style.css' })
    assert.equal((after.match(/style\.css/g) || []).length, 1)
  })

  console.log('\n[5/7] write_file args')
  test('accepts <content> string', () => {
    assert.equal(wfa.getWriteFileContent({ path: 'x', content: 'y' }), 'y')
  })
  test('rejects args without content', () => {
    assert.equal(wfa.getWriteFileContent({ path: 'x', head: 'a', body: 'b' }), null)
  })
  test('rejects non-string content', () => {
    assert.equal(wfa.getWriteFileContent({ path: 'x', content: 42 }), null)
  })

  console.log('\n[6/7] prompt hygiene')
  const toolsSrc = await readFile(`${TS}/tools.ts`, 'utf8')
  test('no "Coming Soon" placeholder in codeSystemPrompt', () => {
    for (const p of ['Coming Soon</title>', '<h1>Coming soon</h1>', 'Notify me']) {
      assert.ok(!toolsSrc.includes(p), `poison: ${p}`)
    }
  })
  test('explicit ban on placeholder text in prompt', () => {
    assert.match(toolsSrc, /NEVER emit.*Coming Soon/)
  })
  test('chat + code prompts are present and well-formed', () => {
    assert.ok(typeof tools.chatSystemPrompt === 'function')
    assert.ok(typeof tools.codeSystemPrompt === 'function')
    // chatSystemPrompt(false) returns the no-tools path
    const chatBare = tools.chatSystemPrompt(false)
    assert.match(chatBare, /100% locally/)
    // chatSystemPrompt(true) includes the tool-use section
    const chatTools = tools.chatSystemPrompt(true)
    assert.match(chatTools, /TOOL USE/)
    // codeSystemPrompt always includes the goal and tool docs
    const code = tools.codeSystemPrompt('/tmp/ws', 'http://x')
    assert.ok(code.includes('GOAL'))
    assert.ok(code.includes('write_file'))
  })

  console.log('\n[7/7] model registry')
  const shared = await readFile('src/shared/types.ts', 'utf8')
  test('Gemma 4 12B is registered', () => {
    assert.match(shared, /gemma-4-12b/)
    assert.match(shared, /Gemma 4 12B/)
  })
  test('Gemma 2 2B is the recommended default', () => {
    assert.match(shared, /name: 'mlx-community\/gemma-2-2b-it-4bit'/)
    assert.match(shared, /recommended: true/)
  })
  test('large models are gated behind manual override', () => {
    assert.match(shared, /gemma-4-26b-a4b-it-4bit/)
    assert.match(shared, /gemma-4-31b-it-4bit/)
    assert.match(shared, /requiresManualOverride: true/)
  })
  test('no duplicate model names', () => {
    const names = [...shared.matchAll(/name: '(mlx-community\/[^']+)'/g)].map((m) => m[1])
    const unique = new Set(names)
    assert.equal(unique.size, names.length, `duplicates: ${names.length - unique.size}`)
    assert.ok(names.length >= 5, `expected ≥5 models, got ${names.length}`)
  })

  console.log(`\n── ${passed} tests passed ──`)
  if (process.exitCode) process.exit(process.exitCode)
}

main().catch((e) => {
  console.error('test runner crashed:', e)
  process.exit(1)
})
