// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../retrieval.cjs'),C=require('../core.cjs');
const entry=(id,vector,keywords=[])=>({id,from:id,to:id,title:'기록 '+id,text:'사건 기록 '+id,keywords,embedding:{signature:'model-a',vector}});
test('cosine rejects invalid, zero, and mismatched vectors rather than inventing scores',()=>{
  assert.equal(R.cosine([1,0],[1,0]),1);assert.equal(R.cosine([1,0],[0,1]),0);
  assert.equal(R.cosine([1,0],[-1,0]),-1);
  for(const bad of [[],[0,0],[NaN,1],[Infinity,1],[1]])assert.equal(R.cosine([1,0],bad),null);
});
test('semantic matches and exact keywords can each qualify; irrelevant chunks and other models cannot',()=>{
  const entries=[entry(1,[1,0]),entry(2,[0,1],['마그나']),entry(3,[0,1]),entry(4,[1,0])];
  entries[3].embedding.signature='model-b';
  const rows=R.rank(entries,'마그나와 보상을 논의한다',[1,0],'model-a',0.8);
  assert.deepEqual(rows.map(r=>r.entry.id),[1,2]);assert.equal(rows[1].semantic,0);assert.deepEqual(rows[1].keywords,['마그나']);
  assert.deepEqual(R.rank(entries,'마그나',null,'model-a',0.8).map(r=>r.entry.id),[2]);
});
test('recall uses whole stored chunks within the cap; never resummarizes or truncates a contract',()=>{
  const huge=entry(1,[1,0]),small=entry(2,[1,0]);huge.text='장'.repeat(1000);small.text='전리품 절반을 받기로 합의함.';
  const s=C.settings({recallCharBudget:350,recallTopK:1}),ranked=[{entry:huge},{entry:small}];
  const out=R.select(ranked,s,C.entryText,C.chars);
  assert.equal(out.selected.length,1);assert.equal(out.selected[0].entry.id,2);assert.match(out.text,/전리품 절반/);assert(C.chars(out.text)<=350);
  assert.match(out.text,/새 사실이나 현재 상태가 아니다/);
});
test('query uses current input and immediate context, without reading old raw or state snapshots',()=>{
  const tl={turns:[{messages:[{role:'user',data:'먼 과거 원문'}]},
    {messages:[{role:'char',data:'성채로 돌아왔다.<hre_state>{"debt":"과거 부채"}</hre_state>'}]},
    {messages:[{role:'char',data:'마그나가 보상을 묻는다.[HRE_IMG:M:1]'}]}],pending:[{role:'user',data:'약속한 전리품을 요구한다.'}]};
  const query=R.query(tl);assert.match(query,/전리품/);assert.match(query,/마그나/);
  assert(!query.includes('먼 과거'));assert(!query.includes('과거 부채'));assert(query.includes('[HRE_IMG:M:1]')); // Unknown custom markup is not interpreted.
});
test('hybrid re-exposes selected summaries near current input and remains idempotent on retries',async()=>{
  const raw=[];for(let i=1;i<=10;i++)raw.push({role:'user',data:'입력'+i,chatId:'u'+i},{role:'char',data:'응답'+i,chatId:'a'+i});
  raw.push({role:'user',data:'현재 입력',chatId:'current'});
  const tl=await C.timeline(raw),state=C.commit(C.emptyState(),tl.turns.slice(0,5),{title:'보상 합의',keywords:['보상'],text:'1073.05.03 저녁 — 선금 지급에 합의함.'});
  const input=[{role:'system',content:'고정 카드',memo:'card'},...raw.map(m=>({role:m.role==='char'?'assistant':'user',content:m.data,memo:m.chatId}))];
  const s=C.settings({mode:'hybrid'}),recall='선택된 저장 청크',out=C.inject(input,state,tl,s,()=>{},recall);
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u6'));
  assert.equal(out.at(-2).content,recall);assert.equal(out.at(-1).memo,'current');assert.equal(out[0].memo,'card');
  assert.match(out.find(m=>m.memo===C.MARK).content,/보상 합의 \(1–5턴\)/);
  assert.deepEqual(C.inject(out,state,tl,s,()=>{},recall),out);
  assert(!C.inject(input,state,tl,C.settings(),()=>{},recall).some(m=>m.memo===C.MARK+'-recall'));
});
