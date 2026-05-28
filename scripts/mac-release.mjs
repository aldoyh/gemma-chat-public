#!/usr/bin/env node
/**
 * mac:release
 *
 * Single-command safe release + install pipeline for macOS (Apple Silicon).
 *
 * Flow (exactly as requested):
 *   1. Lint (typecheck)
 *   2. Build / pack
 *   3. Validate the packed dist bundle ("run dist")
 *   4. Remove old installed app (with safety checks)
 *   5. Copy new release into /Applications (using ditto for correct .app handling)
 *
 * Usage:
 *   npm run mac:release
 *
 * You can also target ~/Applications by setting:
 *   TARGET_APP_DIR=~/Applications npm run mac:release
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

const APP_NAME = 'Gemma Chat'
const PACKED_APP = 'dist/mac-arm64/Gemma Chat.app'
const DEFAULT_TARGET = '/Applications'
let TARGET_DIR = process.env.TARGET_APP_DIR || DEFAULT_TARGET
if (TARGET_DIR.startsWith('~/')) {
  TARGET_DIR = join(process.env.HOME || '', TARGET_DIR.slice(2))
}
const TARGET_APP = join(TARGET_DIR, `${APP_NAME}.app`)

const log = (msg) => console.log(`\n▶ ${msg}`)
const success = (msg) => console.log(`✅ ${msg}`)
const fail = (msg) => { console.error(`\n❌ ${msg}`); process.exit(1) }

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', ...opts })
  } catch (e) {
    fail(`Command failed: ${cmd}`)
  }
}

function isAppRunning() {
  try {
    // Works for both packaged .app and dev Electron
    const result = spawnSync('pgrep', ['-f', APP_NAME], { encoding: 'utf8' })
    return result.status === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}

function validateBundle(appPath) {
  if (!existsSync(appPath)) {
    fail(`Packed app not found at ${appPath}. Did pack succeed?`)
  }
  // Quick structural validation
  const infoPlist = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(infoPlist)) {
    fail(`Invalid .app bundle — missing Info.plist at ${appPath}`)
  }
  // Optional: codesign check (non-fatal)
  const codesign = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'ignore' })
  if (codesign.status !== 0) {
    console.warn('⚠️  codesign verification failed (common for unsigned --dir builds — this is OK for local dev)')
  }
  success(`Bundle validated: ${appPath}`)
}

console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║           Gemma Chat — macOS Release Pipeline              ║')
console.log('╚════════════════════════════════════════════════════════════╝')

// 1. LINT
log('Step 1/5 — Linting (typecheck)')
run('npm run typecheck')

// 2. BUILD / PACK
log('Step 2/5 — Building and packing (electron-builder --dir)')
run('npm run pack')

// 3. "RUN DIST" — validate the produced distributable
log('Step 3/5 — Validating packed distributable')
validateBundle(PACKED_APP)

// 4 + 5. SAFELY REPLACE IN APPLICATIONS FOLDER
log('Step 4/5 — Safety checks before replacing installed app')

if (isAppRunning()) {
  fail(`${APP_NAME} appears to be running. Please quit it first, then re-run this command.`)
}

if (existsSync(TARGET_APP)) {
  console.log(`   Removing old version at ${TARGET_APP}...`)
  try {
    rmSync(TARGET_APP, { recursive: true, force: true })
  } catch (e) {
    fail(`Failed to remove old app: ${e.message}`)
  }
  success('Old version removed')
} else {
  console.log('   No previous installation found.')
}

// 5. COPY WITH DITTO (best practice for macOS .app bundles)
log('Step 5/5 — Installing new version')
console.log(`   Source:      ${PACKED_APP}`)
console.log(`   Destination: ${TARGET_APP}`)

const ditto = spawnSync('ditto', [PACKED_APP, TARGET_APP], { stdio: 'inherit' })
if (ditto.status !== 0) {
  fail('ditto copy failed')
}

success(`Installed to ${TARGET_APP}`)

console.log('\n════════════════════════════════════════════════════════════')
console.log('🎉  Release pipeline completed successfully!')
console.log(`   You can now launch "${APP_NAME}" from /Applications (or Spotlight).`)
console.log('════════════════════════════════════════════════════════════\n')