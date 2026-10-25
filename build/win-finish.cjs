// Applies icon + version info to Orbi.exe (pure JS, no Wine) and compiles the NSIS installer.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ResEdit = require('resedit')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const exePath = path.join(root, 'release', 'win-unpacked', 'Orbi.exe')

const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
const res = ResEdit.NtExecutableResource.from(exe)

const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')))
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
const groupId = groups.length ? groups[0].id : 1
const lang = groups.length ? groups[0].lang : 1033
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data))

const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries)
const v = pkg.version.split('.').map(Number)
const info = vi ?? ResEdit.Resource.VersionInfo.createEmpty()
info.setFileVersion(v[0], v[1], v[2], 0, 1033)
info.setProductVersion(v[0], v[1], v[2], 0, 1033)
info.setStringValues(
  { lang: 1033, codepage: 1200 },
  {
    ProductName: 'Orbi',
    FileDescription: 'Orbi',
    CompanyName: 'OrbiX',
    LegalCopyright: '© 2026 OrbiX',
    OriginalFilename: 'Orbi.exe',
    InternalName: 'Orbi',
    FileVersion: pkg.version,
    ProductVersion: pkg.version,
  },
)
info.outputToResourceEntries(res.entries)
res.outputResource(exe)
fs.writeFileSync(exePath, Buffer.from(exe.generate()))
console.log('icon + version applied to', exePath)

const nsisDir = fs
  .readdirSync(path.join(require('node:os').homedir(), '.cache', 'electron-builder'))
  .filter((d) => d.startsWith('nsis-3'))
  .map((d) => path.join(require('node:os').homedir(), '.cache', 'electron-builder', d))
  .flatMap((d) => fs.readdirSync(d).map((x) => path.join(d, x)).filter((x) => fs.statSync(x).isDirectory()))
  .find((d) => fs.existsSync(path.join(d, 'linux', 'makensis')))
if (!nsisDir) throw new Error('NSIS not found — run electron-builder once to download it')

execFileSync(path.join(nsisDir, 'linux', 'makensis'), ['-V2', `-DVERSION=${pkg.version}`, path.join(__dirname, 'installer.nsi')], {
  stdio: 'inherit',
  env: { ...process.env, NSISDIR: nsisDir },
})
console.log('installer:', path.join(root, 'release', `Orbi-Setup-${pkg.version}.exe`))
