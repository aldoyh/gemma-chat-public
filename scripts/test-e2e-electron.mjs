// End-to-end test: launch the real Electron app, type a chat prompt, send it,
// and capture the assistant's streamed reply. This is the only way to catch
// bugs in the renderer's interaction with the IPC bridge — curl can't see them.
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT = process.cwd()
const ENTRY = join(PROJECT, 'out/main/index.js')

if (!existsSync(ENTRY)) {
  console.error('out/main/index.js missing — run `npm run build` first')
  process.exit(1)
}

const PROMPT = 'Reply with exactly the word OK and nothing else.'
const EXPECT = 'OK'

async function main() {
  console.log('[e2e] launching electron…')
  // Use a separate user-data dir so the e2e run doesn't collide with the
  // user's running app via the single-instance lock, but seed it with a
  // symlink to the real HuggingFace model cache so the MLX server doesn't
  // have to re-download the model files.
  const userDataDir = '/tmp/gemma-chat-e2e'
  const realUserData = `${process.env.HOME}/Library/Application Support/gemma-chat`
  if (existsSync(`${realUserData}/mlx/models`)) {
    try {
      mkdirSync(`${userDataDir}/mlx`, { recursive: true })
      symlinkSync(`${realUserData}/mlx/models`, `${userDataDir}/mlx/models`)
      console.log('[e2e] symlinked model cache → fast cold start')
    } catch (e) {
      console.log('[e2e] could not symlink cache:', e?.message)
    }
  }
  const app = await electron.launch({
    args: [PROJECT, `--user-data-dir=${userDataDir}`],
    timeout: 90_000,
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })

  // Capture all console + page errors
  app.on('console', (msg) => {
    console.log(`[renderer ${msg.type()}]`, msg.text())
  })

  const win = await app.firstWindow({ timeout: 60_000 })
  await win.waitForLoadState('domcontentloaded')
  console.log('[e2e] window loaded, url=', win.url())

  // Wait for the chat composer (textarea) or the setup screen
  await win.waitForSelector('textarea, button, [role=button]', { timeout: 30_000 })
  console.log('[e2e] initial UI rendered')

  // Wait specifically for the chat composer textarea (placeholder "Message
  // Gemma…"). This is the only textarea in the app — Setup.tsx has none.
  // If the setup screen is up, click its current primary action first.
  const primaryAction = await win
    .locator('button')
    .filter({ hasText: /^(Connect to|Download Gemma|Download from Local File)/ })
    .last()
    .elementHandle()
  if (primaryAction) {
    console.log('[e2e] setup screen up, clicking primary action…')
    await primaryAction.click()
  }
  const composer = await win.waitForSelector('textarea[placeholder*="Gemma"]', { timeout: 240_000 })
  console.log('[e2e] composer present')

  await composer.fill(PROMPT)
  console.log('[e2e] prompt typed:', PROMPT)

  // Composer sends on Enter (Composer.tsx onKeyDown).
  await composer.press('Enter')
  console.log('[e2e] enter pressed, waiting for reply…')

  // Poll the body for the expected reply within 240s.
  const start = Date.now()
  let last = ''
  let prevLast = ''
  while (Date.now() - start < 240_000) {
    last = (await win.locator('body').innerText()).slice(-2000)
    // Pass when we see a "Reply: <EXPECT>" or "assistant" block containing
    // the expected word as a standalone token, and not just the user prompt.
    const bodyWithoutPrompt = last.split(PROMPT).join('')
    if (
      last !== prevLast &&
      bodyWithoutPrompt.match(new RegExp(`\\b${EXPECT}\\b`))
    ) {
      break
    }
    prevLast = last
    await win.waitForTimeout(1000)
  }
  const stripped = last.split(PROMPT).join('')
  const ok = new RegExp(`\\b${EXPECT}\\b`).test(stripped)
  console.log(`[e2e] ${ok ? 'PASS' : 'FAIL'} — expected "${EXPECT}" as standalone token in body (after stripping the prompt)`)
  console.log(`[e2e] elapsed: ${Math.round((Date.now() - start) / 1000)}s`)
  console.log('[e2e] tail of body:')
  console.log(last.slice(-800))

  // Dump the last 30 renderer console messages for debugging
  console.log('[e2e] done')
  await app.close()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('[e2e] crashed:', e?.stack || e)
  process.exit(2)
})
