// Writes electron/build-info.json so the updater knows which build is running.
const fs = require('node:fs')
const path = require('node:path')
const pkg = require('../package.json')
fs.writeFileSync(path.join(__dirname, '..', 'electron', 'build-info.json'), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() }, null, 2) + '\n')
console.log('build-info:', pkg.version)
