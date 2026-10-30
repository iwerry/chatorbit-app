const fs = require('node:fs')
const path = require('node:path')
const version = require('../package.json').version
function collect(source, output, target) {
  fs.mkdirSync(output, { recursive: true })
  const platforms = {}
  const arch = target.startsWith('aarch64') ? 'aarch64' : 'x86_64'
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() && !entry.name.endsWith('.app') ? walk(path.join(dir, entry.name)) : entry.isFile() ? [path.join(dir, entry.name)] : [])
  const files = walk(source).filter((file) => /\.(?:dmg|deb|AppImage|app\.tar\.gz)(?:\.sig)?$/.test(file))
  for (const file of files) {
    const name = `Orbi_${version}_${target}_${path.basename(file)}`
    fs.copyFileSync(file, path.join(output, name))
    if (!file.endsWith('.sig')) continue
    const artifact = file.slice(0, -4)
    if (!fs.existsSync(artifact)) throw new Error(`Signature has no package: ${file}`)
    const signature = fs.readFileSync(file, 'utf8').trim()
    if (!signature) throw new Error('Empty native package signature')
    const url = `https://github.com/iwerry/chatorbit-app/releases/download/native-v${version}/${encodeURIComponent(name.slice(0, -4))}`
    if (artifact.endsWith('.AppImage')) platforms[`linux-${arch}-appimage`] = { url, signature }
    if (artifact.endsWith('.deb')) platforms[`linux-${arch}-deb`] = { url, signature }
    if (artifact.endsWith('.app.tar.gz')) { platforms[`darwin-${arch}`] = { url, signature }; platforms[`darwin-${arch}-app`] = { url, signature } }
  }
  if (!Object.keys(platforms).length) throw new Error(`No signed update artifacts for ${target}`)
  fs.writeFileSync(path.join(output, `fragment-${target}.json`), JSON.stringify({ version, platforms }, null, 2))
}
function merge(root, output) {
  const platforms = {}
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  for (const file of walk(root).filter((file) => /fragment-.*\.json$/.test(file))) {
    const fragment = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (fragment.version !== version) throw new Error('Cannot publish mixed native versions')
    for (const [key, value] of Object.entries(fragment.platforms)) { if (platforms[key]) throw new Error(`Duplicate platform ${key}`); platforms[key] = value }
  }
  for (const key of ['linux-x86_64-appimage', 'linux-x86_64-deb', 'darwin-aarch64', 'darwin-x86_64']) if (!platforms[key]) throw new Error(`Missing signed target: ${key}`)
  const manifest = { version, commit: process.env.GITHUB_SHA || null, notes: fs.readFileSync(path.join(__dirname, '../RELEASE_NOTES.md'), 'utf8').slice(0, 6000), pub_date: new Date().toISOString(), platforms }
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n')
}
if (require.main === module) { const [mode, ...args] = process.argv.slice(2); if (mode === 'collect') collect(...args); else if (mode === 'merge') merge(...args); else throw new Error('Use collect or merge') }
module.exports = { collect, merge }
