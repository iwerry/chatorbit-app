// Writes electron/build-info.json so the updater knows which build is running.
// `core` fingerprints everything outside the UI bundle (dist/): the Electron main process, the preload,
// dependencies and the installer. When two releases have the same `core`, the newer one can be applied
// as a UI-only update without reinstalling or restarting Orbi.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.join(__dirname, '..')
const pkg = require('../package.json')

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}
const h = crypto.createHash('sha256')
const files = [
  ...walk(path.join(root, 'electron')).filter((f) => !f.endsWith('build-info.json')),
  ...['pnpm-lock.yaml', 'build/installer.nsi', 'build/win-finish.cjs'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f)),
].sort()
for (const f of files) {
  h.update(path.relative(root, f).split(path.sep).join('/'))
  h.update(fs.readFileSync(f))
}
const { version: _v, ...pkgRest } = pkg
h.update(JSON.stringify(pkgRest))
const core = h.digest('hex').slice(0, 16)

fs.writeFileSync(path.join(root, 'electron', 'build-info.json'), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString(), core }, null, 2) + '\n')
console.log('build-info:', pkg.version, 'core', core)
