// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {deflateRawSync}=require('node:zlib');
const root=__dirname,version=require('./package.json').version;
execFileSync(process.execPath,['build.cjs'],{cwd:root,stdio:'inherit'});
const files=[
 'core.cjs','providers.cjs','retrieval.cjs','storage.cjs','platform.cjs','runtime.js','Chronicle_Control.lua',
 'build.cjs','release.cjs','package.json','README.md','README_KO.md','QUICK_START_KO.md',
 'CHANGELOG.md','RELEASE_NOTES.md',`VALIDATION_v${version}.md`,
 'LICENSE','THIRD_PARTY_NOTICES.md','RPACK_UPSTREAM_LICENSE.txt','RPACK_LICENSE.txt','rpack_map.bin',
 '.gitignore','.github/ISSUE_TEMPLATE/bug_report.md','.github/workflows/release.yml',
 `Chronicle_Memory_v${version}.js`,`Chronicle_Control_v${version}.charx`,
 `Chronicle_Control_v${version}.risum`,`Chronicle_Control_v${version}.module.json`,
 ...['core','embeddings','providers','retrieval','runtime','storage','platform'].map(name=>`tests/${name}.test.cjs`)
];
function crc32(buf){let value=0xffffffff;for(const b of buf){value^=b;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function zip(files){
  let offset=0;const local=[],central=[];
  for(const [name,content] of files){
    const filename=Buffer.from(name),bytes=Buffer.isBuffer(content)?content:Buffer.from(content),crc=crc32(bytes),compressed=deflateRawSync(bytes,{level:9});
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
    local.push(h,filename,compressed);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    central.push(c,filename);offset+=h.length+filename.length+compressed.length;
  }
  const centralData=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralData.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,centralData,end]);
}

const packed=zip(files.map(name=>['risu-chronicle/'+name,fs.readFileSync(path.join(root,name))]));
const dist=path.join(root,'dist'),filename=`RisuAI_Chronicle_Memory_v${version}.zip`;
fs.mkdirSync(dist,{recursive:true});
fs.writeFileSync(path.join(dist,filename),packed);
const hash=crypto.createHash('sha256').update(packed).digest('hex');
fs.writeFileSync(path.join(dist,filename+'.sha256'),hash+'  '+filename+'\n');
console.log(`Packaged ${files.length} files: dist/${filename} (${packed.length} bytes)`);
console.log('SHA-256: '+hash);
