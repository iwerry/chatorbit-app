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
// 0.1.27-1 → 0.1.27.1 (Windows version resources are four numbers)
const v = pkg.version.split(/[.-]/).map(Number).concat([0, 0, 0, 0]).slice(0, 4)
const numeric = v.join('.')
const info = vi ?? ResEdit.Resource.VersionInfo.createEmpty()
info.setFileVersion(v[0], v[1], v[2], v[3], 1033)
info.setProductVersion(v[0], v[1], v[2], v[3], 1033)
info.setStringValues(
  { lang: 1033, codepage: 1200 },
  {
    ProductName: 'Orbi',
    FileDescription: 'Orbi',
    CompanyName: 'Draft Creative Studio Ltda',
    LegalCopyright: '© 2026 Draft Creative Studio Ltda — Creative Design & Software Development',
    OriginalFilename: 'Orbi.exe',
    InternalName: 'Orbi',
    FileVersion: numeric,
    ProductVersion: pkg.version,
  },
)
info.outputToResourceEntries(res.entries)
res.outputResource(exe)
fs.writeFileSync(exePath, Buffer.from(exe.generate()))
console.log('icon + version applied to', exePath)

// Third-party licenses go into licenses\ instead of sitting next to Orbi.exe (they still ship, as required).
const unpacked = path.join(root, 'release', 'win-unpacked')
fs.mkdirSync(path.join(unpacked, 'licenses'), { recursive: true })
for (const f of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
  const from = path.join(unpacked, f)
  if (fs.existsSync(from)) fs.renameSync(from, path.join(unpacked, 'licenses', f))
}

// NSIS: the copy electron-builder downloads (local builds), or the system makensis (CI: apt install nsis).
const cache = path.join(require('node:os').homedir(), '.cache', 'electron-builder')
const nsisDir = fs.existsSync(cache)
  ? fs
      .readdirSync(cache)
      .filter((d) => d.startsWith('nsis-3'))
      .map((d) => path.join(cache, d))
      .flatMap((d) => fs.readdirSync(d).map((x) => path.join(d, x)).filter((x) => fs.statSync(x).isDirectory()))
      .find((d) => fs.existsSync(path.join(d, 'linux', 'makensis')))
  : null
const makensis = nsisDir ? path.join(nsisDir, 'linux', 'makensis') : 'makensis'
execFileSync(makensis, ['-V2', `-DVERSION=${pkg.version}`, `-DNUMVER=${numeric}`, path.join(__dirname, 'installer.nsi')], {
  stdio: 'inherit',
  env: nsisDir ? { ...process.env, NSISDIR: nsisDir } : process.env,
})
console.log('installer:', path.join(root, 'release', `Orbi-Setup-${pkg.version}.exe`))
