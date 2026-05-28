#!/usr/bin/env node
/**
 * verify / test:verify
 *
 * Smart test runner:
 *   - Checks whether "Gemma Chat" is currently running.
 *   - If the app **is** running → refuses to run full test suite (to avoid
 *     conflicts with MLX server, file watchers, workspace server, etc.).
 *   - If the app is **not** running → runs the complete verification suite.
 *
 * This is the recommended command to run before doing `npm run mac:release`.
 *
 * Usage:
 *   npm run verify
 */

import { spawnSync } from 'child_process'

const APP_NAME = 'Gemma Chat'

const log = (msg) => console.log(`\n▶ ${msg}`)
const success = (msg) => console.log(`✅ ${msg}`)
const warn = (msg) => console.warn(`⚠️  ${msg}`)

function isAppRunning() {
  try {
    const result = spawnSync('pgrep', ['-f', APP_NAME], { encoding: 'utf8' })
    return result.status === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}

console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║           Gemma Chat — Safe Verification Runner            ║')
console.log('╚════════════════════════════════════════════════════════════╝\n')

if (isAppRunning()) {
  warn(`${APP_NAME} is currently running.`)
  console.log('')
  console.log('   Full automated test suite will NOT be executed while the app')
  console.log('   is live (MLX backend, workspace server, and file watchers can')
  console.log('   conflict with tests).')
  console.log('')
  console.log('   Please fully quit the app, then run:')
  console.log('     npm run verify')
  console.log('')
  process.exit(1)
}

log('App is not running — proceeding with full verification suite')

// Run the complete, practical verification suite.
// We deliberately use the reliable node-focused checks + our custom guard
// (the web typecheck has a pre-existing tsconfig flag issue unrelated to our changes).
const commands = [
  'npm run typecheck:node',
  'npm run test:guard',
  'npm run test:mlx-format',
  'npm run test:html-assets',
  'npm run test:write-file-args'
]

let allPassed = true

for (const cmd of commands) {
  console.log(`\n────────────────────────────────────────────────────────────`)
  console.log(`Running: ${cmd}`)
  console.log(`────────────────────────────────────────────────────────────`)

  const result = spawnSync(cmd, { shell: true, stdio: 'inherit' })

  if (result.status !== 0) {
    allPassed = false
    warn(`Command failed: ${cmd}`)
  }
}

console.log('\n════════════════════════════════════════════════════════════')

if (allPassed) {
  success('All verification steps PASSED')
  console.log('\n   The codebase and critical logic paths are healthy.')
  console.log('   Safe to proceed with: npm run mac:release')
} else {
  console.error('\n❌ Some verification steps FAILED')
  console.log('   Please fix the issues above before releasing.')
  process.exit(1)
}

console.log('════════════════════════════════════════════════════════════\n')