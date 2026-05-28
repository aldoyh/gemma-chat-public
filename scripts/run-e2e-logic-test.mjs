#!/usr/bin/env node
/**
 * Runner for the E2E logic tests.
 * Handles bundling the two key modules (message-format + tools) with their dependencies.
 */

import { build } from 'esbuild'
import { rm, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const DIST = 'dist-test'

async function bundleForTest() {
  if (!existsSync(DIST)) {
    await mkdir(DIST, { recursive: true })
  }

  // 1. Bundle message-format (simple, no side effects)
  await build({
    entryPoints: ['src/main/inference/message-format.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(DIST, 'message-format.mjs'),
    logLevel: 'warning'
  })

  // 2. Bundle the tiny pure test barrel (no heavy side effects or workspace runtime)
  await build({
    entryPoints: ['src/main/test-support/prompts-and-parsers.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(DIST, 'prompts-and-parsers.mjs'),
    external: ['fs', 'path', 'child_process', 'os'],
    logLevel: 'warning'
  })

  console.log('  Bundled message-format.mjs + prompts-and-parsers.mjs for E2E test')
}

async function main() {
  console.log('Preparing E2E logic test bundles...')
  await rm(DIST, { recursive: true, force: true })
  await bundleForTest()

  // Now run the actual test (dynamic import so it picks up the fresh bundles)
  const { default: run } = await import('./test-e2e-logic.mjs')
  // The test file is not a module with default export — it runs on import.
  // So we just import it; side effects execute the assertions.
  await import('./test-e2e-logic.mjs')
}

main().catch((err) => {
  console.error('E2E logic test runner failed:')
  console.error(err)
  process.exit(1)
})