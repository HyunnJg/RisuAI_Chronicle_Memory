// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../storage.cjs'),C=require('../core.cjs'),R=require('../retrieval.cjs');
function setup(){const data=new Map(),writes=[];const api={getItem:async k=>data.get(k),setItem:async(k,v)=>{data.set(k,v);writes.push(k);},removeItem:async k=>data.delete(k),keys:async()=>[...data.keys()]};
  return {data,writes,cache:S.create(api,'test:',{validVector:R.validVector,entryHash:e=>C.digest(R.document(e))})};}
test('separate vector store migrates inline cache once and prunes edited or archived entries',async()=>{
  const h=setup(),entry={id:'one',title:'대화',text:'서로 약속함.',keywords:['약속']};
  entry.embedding={signature:'model',hash:await C.digest(R.document(entry)),vector:[1,0]};
  await h.cache.sync('test:chat:c:a',{entries:[entry]});assert.equal(h.writes.filter(k=>k.includes(':vectors:')).length,1);
  await h.cache.sync('test:chat:c:a',{entries:[C.stripDerivedState(entry)]});assert.equal(h.writes.filter(k=>k.includes(':vectors:')).length,1);
  entry.text='약속을 변경함.';delete entry.embedding;await h.cache.sync('test:chat:c:a',{entries:[entry]});
  assert.equal(Object.keys((await h.cache.vectors('test:chat:c:a')).entries).length,0);
});
test('derived cache copies only matching documents and deletes orphan data without another namespace',async()=>{
  const h=setup(),entry={id:'one',text:'함께 만나기로 함.',keywords:[]},vector={signature:'model',hash:await C.digest(R.document({id:'one',text:'함께 만나기로 함.',keywords:[]})),vector:[1,0]};
  await h.cache.saveVectors('test:chat:c:a',{schema:1,entries:{one:vector}});
  await h.cache.copy('test:chat:c:a','test:chat:c:b',[entry]);assert((await h.cache.vectors('test:chat:c:b')).entries.one);
  await h.cache.copy('test:chat:c:a','test:chat:c:x',[{...entry,text:'다른 이야기'}]);assert.equal(Object.keys((await h.cache.vectors('test:chat:c:x')).entries).length,0);
  h.data.set('unrelated:vectors:keep','other plugin');assert.deepEqual((await h.cache.derivedChats()).sort(),['test:chat:c:a','test:chat:c:b']);
  await h.cache.reset('test:chat:c:a');assert.equal(h.data.get('unrelated:vectors:keep'),'other plugin');assert(!h.data.has('test:vectors:c:a'));
  await assert.rejects(()=>h.cache.reset('unrelated:chat:c:a'),/잘못된 기억/);
});
test('query vectors stay in memory and identical recall metadata does not cause repeated writes',async()=>{
  const h=setup(),chat='test:chat:c:a';h.cache.saveQuery(chat,{hash:'query',signature:'model',vector:[1,0]});
  assert.deepEqual(h.cache.query(chat).vector,[1,0]);assert.equal(h.writes.length,0);
  await h.cache.saveRecall(chat,{selected:[],text:'',at:'first'});await h.cache.saveRecall(chat,{selected:[],text:'',at:'later'});
  assert.equal(h.writes.length,1);assert(!h.data.get('test:recall:c:a').includes('vector'));
  await h.cache.reset(chat);assert.equal(h.cache.query(chat),undefined);
});
function presetStore(){
  const data=new Map(),writes=[];
  const api={getItem:async key=>data.get(key),setItem:async(key,value)=>{data.set(key,value);writes.push(key);}};
  return {data,writes,api,presets:S.createPromptPresets(api,'test:summary-presets')};
}
test('prompt presets preserve multiline instructions, empty prompts and special names across reloads',async()=>{
  const h=presetStore();assert.deepEqual(await h.presets.list(),[]);assert.equal(h.writes.length,0);
  const prompt='  약속·관계 우선\n제목 (N–N턴)\n  내용 끝  \n';
  await h.presets.put('  단독용  ',prompt);await h.presets.put('하이파 병행용','');
  await h.presets.put('__proto__','<img src=x onerror=alert(1)>');
  const reloaded=S.createPromptPresets(h.api,'test:summary-presets');
  assert.deepEqual(await reloaded.list(),[{name:'단독용',prompt},{name:'하이파 병행용',prompt:''},{name:'__proto__',prompt:'<img src=x onerror=alert(1)>'}]);
  assert(h.writes.every(key=>key==='test:summary-presets'));
});
test('prompt preset creation rejects blank and duplicate names without overwriting saved instructions',async()=>{
  const h=presetStore();await h.presets.put('단독','original');const stored=h.data.get('test:summary-presets');
  await assert.rejects(()=>h.presets.put(' \n ','bad'),/이름/);
  await assert.rejects(()=>h.presets.put(' 단독 ','bad'),/같은 이름/);
  await assert.rejects(()=>h.presets.put('bad',null),/문자열/);
  assert.equal(h.data.get('test:summary-presets'),stored);assert.equal(h.writes.length,1);
});
test('explicit preset update renames and replaces only the selected version; deletion is scoped',async()=>{
  const h=presetStore(),one=await h.presets.put('단독','one'),two=await h.presets.put('병행','two');
  await assert.rejects(()=>h.presets.put('병행','bad',one),/같은 이름/);
  const updated=await h.presets.put('단독 개선','changed\n',one);
  assert.deepEqual(await h.presets.list(),[updated,two]);
  h.data.set('test:settings','settings');h.data.set('test:chat:c:a','memory');
  await h.presets.remove(two);assert.deepEqual(await h.presets.list(),[updated]);
  assert.equal(h.data.get('test:settings'),'settings');assert.equal(h.data.get('test:chat:c:a'),'memory');
});
test('stale preset edits and deletes do not overwrite a newer saved prompt',async()=>{
  const h=presetStore(),old=await h.presets.put('단독','old');
  const current=await h.presets.put('단독','new',old);
  await assert.rejects(()=>h.presets.put('단독','stale',old),/변경/);
  await assert.rejects(()=>h.presets.remove(old),/변경/);
  await h.presets.remove(current);await assert.rejects(()=>h.presets.remove(current),/삭제/);
  assert.deepEqual(await h.presets.list(),[]);
});
test('invalid preset collections are not silently reset by reading or saving',async()=>{
  const h=presetStore();
  for(const raw of ['{invalid',JSON.stringify({schema:2,items:[]}),JSON.stringify({schema:1,items:[{name:'x',prompt:'one'},{name:'x',prompt:'two'}]}),JSON.stringify({schema:1,items:[{name:' x ',prompt:'one'}]})]){
    h.data.set('test:summary-presets',raw);await assert.rejects(()=>h.presets.list(),/덮어쓰지/);
    await assert.rejects(()=>h.presets.put('new','prompt'),/덮어쓰지/);assert.equal(h.data.get('test:summary-presets'),raw);
  }
  assert.equal(h.writes.length,0);
});
test('preset storage write failures preserve the previously saved collection',async()=>{
  const h=presetStore(),one=await h.presets.put('단독','one');
  h.api.setItem=async()=>{throw Error('quota');};
  await assert.rejects(()=>h.presets.put('병행','two'),/quota/);
  await assert.rejects(()=>h.presets.remove(one),/quota/);assert.deepEqual(await h.presets.list(),[one]);
});
