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
