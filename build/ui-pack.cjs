// Packs dist/ into release/orbi-ui-<version>.asar plus a small JSON manifest. The app downloads these
// when a release only changed the UI (same `core` as the installed build) and applies them without a restart.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const root = path.join(__dirname, '..')
const info = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'build-info.json'), 'utf8'))

;(async () => {
  fs.mkdirSync(path.join(root, 'release'), { recursive: true })
  const out = path.join(root, 'release', `orbi-ui-${info.version}.asar`)
  await asar.createPackage(path.join(root, 'dist'), out)
  const buf = fs.readFileSync(out)
  const manifest = { version: info.version, builtAt: info.builtAt, core: info.core, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }
  fs.writeFileSync(path.join(root, 'release', `orbi-ui-${info.version}.json`), JSON.stringify(manifest, null, 2) + '\n')
  console.log('ui pack:', out, manifest.size, 'bytes')
})()
