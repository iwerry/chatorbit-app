const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid application version')
const configPath = path.join(root, 'src-tauri/tauri.conf.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
config.version = version
const publicKey = (process.env.ORBI_UPDATER_PUBLIC_KEY || '').trim()
if (publicKey) {
  if (!/^[A-Za-z0-9+/]+=*$/.test(publicKey)) throw new Error('Invalid native updater public key encoding')
  config.plugins ||= {}
  config.plugins.updater ||= {}
  config.plugins.updater.pubkey = publicKey
}
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
for (const file of ['Cargo.toml', 'Cargo.lock']) {
  const target = path.join(root, 'src-tauri', file)
  const source = fs.readFileSync(target, 'utf8')
  const pattern = file === 'Cargo.lock' ? /(name = "orbi-native"\r?\nversion = ")[^"]+/ : /(\[package\][\s\S]*?\nversion = ")[^"]+/
  if (!pattern.test(source)) throw new Error(`Native package version missing in ${file}`)
  fs.writeFileSync(target, source.replace(pattern, (_, prefix) => prefix + version))
}
console.log(`Native build synchronized to ${version}`)
