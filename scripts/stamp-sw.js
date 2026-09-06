// Runs after `vite build`. The service worker's cache name needs to
// change on every deploy so the browser's activate handler evicts the
// previous deploy's cached assets instead of accumulating them forever —
// see the comment on CACHE_VERSION in public/sw.js for why. Vite doesn't
// hash files under public/ (they're copied to dist/ as-is), so there's
// nothing else that naturally changes sw.js's content between builds for
// the browser to notice; this stamps in a real, unique value.
//
// Also stamps in the real Firebase database URL (see DATABASE_URL in
// sw.js) — needed for the persistent session notification's fully-
// closed-app fallback, which talks to the database directly over REST
// rather than through the Firebase SDK. public/sw.js is a static file
// Vite copies as-is, not a module it bundles, so it has no access to
// import.meta.env the way the rest of the app does; this is how it gets
// the real value instead.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'dist/sw.js'
const buildId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const databaseURL = process.env.VITE_FIREBASE_DATABASE_URL

let content = readFileSync(path, 'utf8')

if (!content.includes('__BUILD_ID__')) {
  console.error(`stamp-sw: __BUILD_ID__ placeholder not found in ${path} — sw.js cache version was not updated.`)
  process.exit(1)
}
content = content.replace('__BUILD_ID__', buildId)

if (!content.includes('__DATABASE_URL__')) {
  console.error(`stamp-sw: __DATABASE_URL__ placeholder not found in ${path} — notification fallback would be broken.`)
  process.exit(1)
}
if (!databaseURL) {
  console.error('stamp-sw: VITE_FIREBASE_DATABASE_URL is not set in the build environment — cannot stamp sw.js.')
  process.exit(1)
}
content = content.replace('__DATABASE_URL__', databaseURL)

writeFileSync(path, content)
console.log(`stamp-sw: service worker cache version set to pace-${buildId}, database URL stamped`)
