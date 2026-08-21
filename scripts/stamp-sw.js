// Runs after `vite build`. The service worker's cache name needs to
// change on every deploy so the browser's activate handler evicts the
// previous deploy's cached assets instead of accumulating them forever —
// see the comment on CACHE_VERSION in public/sw.js for why. Vite doesn't
// hash files under public/ (they're copied to dist/ as-is), so there's
// nothing else that naturally changes sw.js's content between builds for
// the browser to notice; this stamps in a real, unique value.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'dist/sw.js'
const buildId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

const content = readFileSync(path, 'utf8')
if (!content.includes('__BUILD_ID__')) {
  console.error(`stamp-sw: __BUILD_ID__ placeholder not found in ${path} — sw.js cache version was not updated.`)
  process.exit(1)
}
writeFileSync(path, content.replace('__BUILD_ID__', buildId))
console.log(`stamp-sw: service worker cache version set to pace-${buildId}`)
