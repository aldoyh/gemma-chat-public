import assert from 'node:assert/strict'
import { getWriteFileContent } from '../dist-test/write-file-args.mjs'

assert.equal(
  getWriteFileContent({ path: 'index.html', head: '<title>x</title>', body: '<main>x</main>' }),
  null,
  'write_file calls without <content> must be rejected instead of overwriting files'
)

assert.equal(
  getWriteFileContent({ path: 'index.html', content: '<!doctype html>' }),
  '<!doctype html>',
  'write_file calls with content should preserve the content'
)

console.log('write file argument tests passed')
