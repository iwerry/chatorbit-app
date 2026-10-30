const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const {collect,merge}=require('../build/native-manifest.cjs')
const version=require('../package.json').version
function cleanup(root){const base=fs.realpathSync(os.tmpdir());const target=fs.realpathSync(root);const relative=path.relative(base,target);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(target).startsWith('orbi-native-'),'Only this test temporary directory may be removed');fs.rmSync(target,{recursive:true,force:true})}
test('native channel requires every signed platform and preserves matching URLs',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbi-native-manifest-'))
  try {
    const linux=path.join(root,'linux');fs.mkdirSync(linux)
    for(const ext of ['AppImage','deb']){fs.writeFileSync(path.join(linux,`Orbi.${ext}`),'test');fs.writeFileSync(path.join(linux,`Orbi.${ext}.sig`),'test-signature')}
    collect(linux,path.join(root,'out','linux'),'x86_64-unknown-linux-gnu')
    assert.throws(()=>merge(path.join(root,'out'),path.join(root,'latest.json')),/Missing signed target/)
    for(const arch of ['x86_64','aarch64']){const dir=path.join(root,arch);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'Orbi.app.tar.gz'),'test');fs.writeFileSync(path.join(dir,'Orbi.app.tar.gz.sig'),'test-signature');collect(dir,path.join(root,'out',arch),`${arch}-apple-darwin`)}
    merge(path.join(root,'out'),path.join(root,'latest.json'))
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'latest.json'),'utf8'))
    assert.equal(manifest.version,version)
    assert.notEqual(manifest.platforms['darwin-aarch64'].url,manifest.platforms['darwin-x86_64'].url)
    assert.match(manifest.platforms['linux-x86_64-deb'].url,/native-v/)
    const fragment=path.join(root,'out','linux','fragment-x86_64-unknown-linux-gnu.json');const data=JSON.parse(fs.readFileSync(fragment));data.version='9.9.9';fs.writeFileSync(fragment,JSON.stringify(data));assert.throws(()=>merge(path.join(root,'out'),path.join(root,'latest.json')),/mixed native versions/)
  } finally {cleanup(root)}
})
test('signature without its package cannot enter the channel',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbi-native-signature-'));try{fs.writeFileSync(path.join(root,'Orbi.AppImage.sig'),'signature');assert.throws(()=>collect(root,path.join(root,'out'),'x86_64-unknown-linux-gnu'),/no package/)}finally{cleanup(root)}})
