import assert from 'node:assert/strict'
import { ensureHtmlAssetReferences } from '../dist-test/html-assets.mjs'

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Retro Calculator</title>
</head>
<body>
<main>
  <h1>Retro Calculator</h1>
</main>
</body>
</html>`

const repaired = ensureHtmlAssetReferences(html, {
  stylesheet: 'style.css',
  script: 'app.js'
})

assert.equal(
  repaired.includes('<link rel="stylesheet" href="style.css">'),
  true,
  'index.html should reference style.css when that file exists'
)

assert.equal(
  repaired.includes('<script src="app.js" defer></script>'),
  true,
  'index.html should reference app.js when that file exists'
)

assert.equal(
  ensureHtmlAssetReferences(repaired, { stylesheet: 'style.css', script: 'app.js' }),
  repaired,
  'asset reference repair should be idempotent'
)

console.log('html asset reference tests passed')
