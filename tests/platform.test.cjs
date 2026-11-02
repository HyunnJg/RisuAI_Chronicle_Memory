// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../platform.cjs');
test('HTTP-like contexts without Web Crypto are diagnosed without relaxing source validation',()=>{
  const env={isSecureContext:false,crypto:{getRandomValues(){}}};
  assert.equal(E.probe(env).digest,false);assert.equal(E.probe(env).uuid,false);
  assert.throws(()=>E.assertMemory(env),e=>e.code==='CHRONICLE_ENVIRONMENT'&&/HTTPS/.test(e.message)&&/原文|원문/.test(e.message));
  assert.match(E.description(env),/비보안/);
  assert.doesNotThrow(()=>E.assertMemory(globalThis));
});
test('missing UUID support is diagnosed even when SHA-256 exists',()=>{
  assert.match(E.memoryError({crypto:{subtle:{digest(){}}}}),/기록 ID/);
});
test('backup preparation preserves portable JSON and keeps its URL until explicitly released',()=>{
  const revoked=[],made=[];const env={Blob,URL:{createObjectURL:b=>{made.push(b);return 'blob:test';},revokeObjectURL:u=>revoked.push(u)}};
  const value={format:'risu-chronicle-backup',state:{entries:[{text:'한글 기록'}]}};
  const out=E.backup(value,env);assert.deepEqual(JSON.parse(out.text),value);assert.equal(out.url,'blob:test');assert.equal(revoked.length,0);
  assert.equal(made[0].type,'application/json;charset=utf-8');E.releaseBackup(out,env);assert.deepEqual(revoked,['blob:test']);
});
test('unsupported or rejected Blob downloads retain JSON for manual copying',()=>{
  for(const env of [{},{Blob,URL:{createObjectURL(){throw Error('not supported');}}}]){
    const result=E.backup({text:'백업'},env);assert.equal(result.url,'');assert.equal(JSON.parse(result.text).text,'백업');E.releaseBackup(result,env);
  }
});
test('file import supports both File.text and FileReader without changing JSON',async()=>{
  assert.equal(await E.readFile({text:async()=>'"파일"'},{}),'"파일"');
  class Reader{readAsText(file,encoding){assert.equal(encoding,'UTF-8');this.result=file.value;this.onload();}}
  assert.equal(await E.readFile({value:'{"한글":1}'},{FileReader:Reader}),'{"한글":1}');
  await assert.rejects(()=>E.readFile({},{}),/JSON 파일을 읽을 수 없습니다/);
});
test('file read errors are surfaced without treating the import as successful',async()=>{
  class Reader{readAsText(){this.onerror();}}
  await assert.rejects(()=>E.readFile({},{FileReader:Reader}),/읽기에 실패/);
});
