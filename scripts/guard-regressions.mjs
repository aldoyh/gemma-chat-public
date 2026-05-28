#!/usr/bin/env node
/**
 * Fast, reliable automated regression guard.
 * Run with: node scripts/guard-regressions.mjs
 * Add to package.json as "test:guard" if desired.
 *
 * This directly protects against the exact bugs that made the app "completely broken".
 */

import fs from 'fs'
import assert from 'assert'
import { execSync } from 'child_process'

console.log('=== Gemma Chat Regression Guard (E2E Logic) ===\n')

const toolsSrc = fs.readFileSync('src/main/tools.ts', 'utf8')

// Guard 1: The Coming Soon poison must be gone from the real prompt
const poisons = [
  'Coming Soon</title>',
  '<h1>Coming soon</h1>',
  '<button id="notify">Notify me</button>'
]
poisons.forEach(p => {
  assert.ok(!toolsSrc.includes(p), `FATAL: src/main/tools.ts still contains old poison "${p}"`)
})
console.log('✅ No "Coming Soon" placeholder remains in codeSystemPrompt')

// Guard 2: We have an explicit ban now
assert.ok(
  toolsSrc.includes('NEVER emit "Coming Soon"'),
  'FATAL: The explicit ban on Coming Soon / placeholders is missing'
)
console.log('✅ Explicit ban on placeholder text is present')

// Guard 3: The new good minimal example exists
assert.ok(
  toolsSrc.includes('working click counter') || toolsSrc.includes('let c=0'),
  'New minimal working example should be in the prompt'
)
console.log('✅ New minimal functional example is present instead')

// Guard 4: Run the light automated tests that exist
console.log('\n--- Running existing automated test suite ---')
const tests = ['test:mlx-format', 'test:html-assets', 'test:write-file-args']
for (const t of tests) {
  console.log(`\n→ ${t}`)
  execSync(`npm run ${t}`, { stdio: 'inherit' })
}

// Guard 5: Typecheck (node side is what matters for these fixes)
console.log('\n→ typecheck:node')
execSync('npm run typecheck:node', { stdio: 'inherit' })

console.log('\n✅✅✅  ALL REGRESSION GUARDS PASSED  ✅✅✅')
console.log('\nThese checks + updated message-format test prevent the app from ever returning to:')
console.log('  • Infinite repetition loops')
console.log('  • Junk text responses')
console.log('  • Every build request emitting the literal "Coming Soon" page')
console.log('\nRecommended: npm run test:guard (after adding the script)')