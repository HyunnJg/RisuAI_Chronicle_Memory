// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function raw(n,pending=false) {
  const result=[];
  for(let i=1;i<=n;i++)result.push({role:'user',data:`사용자 ${i}`,chatId:`u${i}`},{role:'char',data:`응답 ${i}`,chatId:`a${i}`});
  if(pending) result.push({role:'user',data:`다음 입력`,chatId:`u${n+1}`});
  return result;
}
const messages=r=>[{role:'system',content:'고정 규칙',memo:'rules'},...r.map(m=>({role:m.role==='char'?'assistant':'user',content:m.data,memo:m.chatId})),{role:'system',content:'출력 형식',memo:'format'}];
async function stateWith(n=5,all=10) {
  const tl=await C.timeline(raw(all,true));
  return {tl,state:C.commit(C.emptyState(),tl.turns.slice(0,n),'T1: 금화 20개 수령. T5: 영주에게 보고.')};
}
test('timeline cache compares full contents and matches uncached hashes through edits, deletions and branches',async()=>{
  const reader=C.createTimelineReader(),source=raw(12,true);
  async function same(value){assert.deepEqual(await reader(value),await C.timeline(value));}
  await same(source);await same(structuredClone(source));
  source[1].data='변경 1';await same(source); // Same ID/length as 응답 1.
  source[0].saying='화자 변경';await same(source);
  source[3].chatId='replacement';await same(source);
  source[4].role='assistant';await same(source);
  source[8].disabled=true;await same(source);
  source[9].isComment=true;await same(source);
  source[10].disabled='allBefore';await same(source);
  await same(source.slice(0,7));await same(raw(18,true));await same(raw(5));
  const branch=raw(18,true);branch[4].data='분기 원문';await same(branch);
  branch.at(-1).data='다른 현재 입력';await same(branch);
});
test('unchanged prefixes reuse SHA-256 results but an equal-length early edit rebuilds both chains',async()=>{
  let hashes=0;const sandbox={module:{exports:{}},TextEncoder,crypto:{subtle:{digest:(...args)=>{hashes++;return crypto.subtle.digest(...args);}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../core.cjs'),'utf8'),sandbox);
  const cached=sandbox.module.exports,reader=cached.createTimelineReader(),source=raw(5);
  await reader(source);assert.equal(hashes,11);
  hashes=0;await reader(structuredClone(source));assert.equal(hashes,1);
  source.push({role:'user',data:'새 입력',chatId:'u6'},{role:'char',data:'새 응답',chatId:'a6'});
  hashes=0;await reader(source);assert.equal(hashes,3);
  source[1].data='변경 1';hashes=0;const result=await reader(source);assert.equal(hashes,13);
  assert.equal(JSON.stringify(result),JSON.stringify(await C.timeline(source)));
});
test('settings reject invalid ranges and unsupported modes',()=>{
  assert.equal(C.settings().enabled,false);
  for(const value of [0,4,21,NaN,5.5])assert.throws(()=>C.settings({interval:value}));
  assert.throws(()=>C.settings({provider:'unknown'}));
  assert.throws(()=>C.settings({charsPerTurn:201}));
  assert.equal(C.settings({summaryTimeoutSeconds:NaN,memoryCharBudget:0}).summaryTimeoutSeconds,undefined);
  assert.throws(()=>C.settings({cleanSummaryInput:'yes'}));
});
test('Risu cooperation has independent advisory compact targets and validated scope overrides',async()=>{
  const normal=C.settings(),paired=C.settings({mode:'risu'});
  assert.equal(C.summaryTarget(normal,5),500);assert.equal(C.summaryTarget(paired,5),250);
  assert.equal(paired.risuLogScope,'all');
  for(const v of [0,9,201,NaN])assert.throws(()=>C.settings({risuCharsPerTurn:v}));
  for(const v of [0,101,1.5])assert.throws(()=>C.settings({risuRecentChunks:v}));
  assert.throws(()=>C.settings({risuLogScope:'invalid'}));
  const resolved=C.chatSettings(normal,{scriptstate:{$chronicle_mode:'risu',$chronicle_risu_chars:'30',$chronicle_risu_scope:'recent',$chronicle_risu_chunks:'3'}});
  assert.equal(resolved.mode,'risu');assert.equal(C.summaryTarget(resolved,5),150);
  assert.equal(resolved.risuLogScope,'recent');assert.equal(resolved.risuRecentChunks,3);
  const batch=(await C.timeline(raw(5))).turns,s=C.settings({...resolved,customPrompt:'약속과 관계 변화는 한국어로 보존'});
  const prompt=C.summaryPrompt(batch,s);
  assert.match(prompt[0].content,/약 150글자/);assert.match(prompt[0].content,/간결한 사실구/);assert(prompt[0].content.includes(s.customPrompt));
  assert.deepEqual(JSON.parse(prompt[1].content).map(t=>t.turn),[1,2,3,4,5]);
  const long=C.parseSummary(JSON.stringify({from:1,to:5,title:'기록',keywords:[],events:[{summary:'가'.repeat(1000)}]}),batch,s);
  assert.equal(long.text.length,1000);assert.equal(long.targetChars,150);
});
test('Risu cooperation preserves native memory, raw messages and third-party content for every injection scope',async()=>{
  const tl=await C.timeline(raw(15,true));let state=C.emptyState();
  for(let i=0;i<15;i+=5)state=C.commit(state,tl.turns.slice(i,i+5),`원본 기록 ${i+1}`);
  const snapshot=structuredClone(state),incoming=[{role:'system',content:'규칙',memo:'cards'},
    {role:'system',content:'<Past Events Summary>하이파 기억</Past Events Summary>',memo:'supaMemory'},
    {role:'assistant',content:'내장 기억이 남긴 최근 응답',memo:'a15',cachePoint:true},
    {role:'user',content:'현재 입력',multimodals:[{type:'image',base64:'test'}]}];
  for(const scope of ['all','recent','none']){
    const warnings=[],s=C.settings({mode:'risu',risuLogScope:scope,risuRecentChunks:1});
    const out=C.inject([...incoming,{role:'system',content:'이전 연대기',memo:C.MARK},{role:'system',content:'이전 자체 검색',memo:C.MARK+'-recall'}],state,tl,s,w=>warnings.push(w),'보내면 안 되는 자체 검색');
    assert.deepEqual(out.filter(m=>m.memo!==C.MARK),incoming);assert.deepEqual(warnings,[]);
    const text=out.find(m=>m.memo===C.MARK)?.content||'';
    assert.equal(text.includes(C.entryText(state.entries[0])),scope==='all');assert.equal(text.includes('원본 기록 11'),scope!=='none');
    assert.equal(out.filter(m=>m.memo===C.MARK).length,scope==='none'?0:1);
    assert(!out.some(m=>m.memo===C.MARK+'-recall'));assert.deepEqual(state,snapshot);
    assert(C.memoryText(state).includes('원본 기록 1')); // Storage preview/backup is always complete.
  }
  assert.equal(C.injectedEntries(state,C.settings({risuLogScope:'none'})).length,3);
});
test('one turn is a user/AI cycle; greeting and pending input do not add turns',async()=>{
  const tl=await C.timeline([{role:'char',data:'인사',chatId:'g'},...raw(5,true)]);
  assert.equal(tl.turns.length,5);assert.equal(tl.pending.length,1);assert.equal(tl.turns[0].messages.length,3);
  const onlyGreeting=await C.timeline([{role:'char',data:'인사',chatId:'g'},{role:'user',data:'안녕',chatId:'u'}]);
  assert.equal(onlyGreeting.turns.length,0);assert.equal(onlyGreeting.pending.length,2);
});
test('consecutive users share a turn but separately stored AI replies each advance it',async()=>{
  const tl=await C.timeline([{role:'user',data:'첫째'},{role:'user',data:'둘째'},{role:'char',data:'답'},{role:'char',data:'계속'}]);
  assert.equal(tl.turns.length,2);assert.equal(tl.turns[0].messages.length,3);
  assert.deepEqual(tl.turns[1].messages,[{role:'char',data:'계속'}]);
});
test('AI-only progression after a greeting counts responses without counting the greeting',async()=>{
  const source=[{role:'char',data:'첫 인사',chatId:'g'}];
  assert.equal((await C.timeline(source)).turns.length,0);
  for(let n=1;n<=12;n++)source.push({role:'char',data:`진행 ${n}`,chatId:`a${n}`});
  const tl=await C.timeline(source);
  assert.equal(tl.turns.length,12);assert.equal(tl.turns[0].messages[0].chatId,'g');
  assert.equal(tl.turns.at(-1).messages[0].chatId,'a12');
});
test('in-place continuation and regeneration do not add turns and invalidate affected chunks',async()=>{
  const source=raw(10),before=await C.timeline(source);
  let state=C.commit(C.emptyState(),before.turns.slice(0,5),'첫 구간');
  state=C.commit(state,before.turns.slice(5,10),'둘째 구간');
  source.at(-1).data+=' 덧붙인 이어쓰기';
  const after=await C.timeline(source),next=C.reconcile(state,after);
  assert.equal(after.turns.length,10);assert.equal(next.entries.length,1);
  assert.equal(next.entries[0].text,'첫 구간');assert.equal(next.archive[0].entries[0].from,6);
  source.at(-1).data='재생성한 응답';source.at(-1).chatId='replacement';
  assert.equal((await C.timeline(source)).turns.length,10);
});
test('legacy chunk that grouped separate AI messages is archived instead of silently reused',async()=>{
  const source=raw(5);source.splice(2,0,{role:'char',data:'추가 진행',chatId:'extra'});
  let chain='chronicle-v1';
  const oldTurns=[source.slice(0,3),...Array.from({length:4},(_,i)=>source.slice(3+i*2,5+i*2))];
  for(const group of oldTurns)chain=await C.digest([chain,group.map(m=>[m.role,m.data,m.chatId||'',m.saying||''])]);
  const state={...C.emptyState(),entries:[{id:'old',from:1,to:5,hash:chain,text:'이전 턴 기준의 기록'}]};
  const next=C.reconcile(state,await C.timeline(source));
  assert.equal(next.entries.length,0);assert.equal(next.archive[0].entries[0].text,'이전 턴 기준의 기록');
});
test('disabled/reset messages are excluded from summaries',async()=>{
  const r=raw(5);r[3].disabled='allBefore';r[6].disabled=true;
  const tl=await C.timeline(r);assert.equal(tl.active[0].chatId,'u3');
  assert(!tl.active.some(m=>m.chatId==='u4'));
});
test('no summary before interval; committed chunk is never resummarized',async()=>{
  const tl=await C.timeline(raw(9));let state=C.emptyState(),s=C.settings();
  assert.equal(C.nextBatch(state,await C.timeline(raw(4)),s).length,0);
  const batch=C.nextBatch(state,tl,s);assert.deepEqual(batch.map(t=>t.number),[1,2,3,4,5]);
  state=C.commit(state,batch,'사건 기록');assert.equal(C.nextBatch(state,tl,s).length,0);
});
test('standalone removes only covered older messages and preserves prefix/suffix/pending',async()=>{
  const {state,tl}=await stateWith();const input=messages(raw(10,true));
  const out=C.inject(input,state,tl,C.settings());
  assert.equal(out[0].content,'고정 규칙');assert.equal(out.at(-1).content,'출력 형식');
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u6'));assert(out.some(m=>m.memo==='u11'));
  assert.equal(out.filter(m=>m.memo===C.MARK).length,1);
  assert.equal(input.length,23); // Input is not mutated.
});
test('uncovered old messages survive even beyond recent window',async()=>{
  const {state,tl}=await stateWith(5,14);
  const out=C.inject(messages(raw(14,true)),state,tl,C.settings());
  assert(out.some(m=>m.memo==='u6'));assert(!out.some(m=>m.memo==='u5'));
});
test('hybrid trims the same older raw as standalone and preserves recent multimodal objects',async()=>{
  const {state,tl}=await stateWith();const input=messages(raw(10,true));input[14].multimodals=[{type:'image',base64:'example'}];
  const out=C.inject(input,state,tl,C.settings({mode:'hybrid'}));
  const standalone=C.inject(input,state,tl,C.settings());
  assert.deepEqual(out,standalone);assert(out.some(m=>m.multimodals?.[0].base64==='example'));
});
test('retries inject exactly one own memory message',async()=>{
  const {state,tl}=await stateWith();const s=C.settings();
  const once=C.inject(messages(raw(10,true)),state,tl,s),twice=C.inject(once,state,tl,s);
  assert.deepEqual(twice,once);
});
test('missing memo preserves the entire incoming request and warns instead of unsafe trimming',async()=>{
  const {state,tl}=await stateWith();const input=messages(raw(10,true));delete input.at(-2).memo;
  const warnings=[],out=C.inject(input,state,tl,C.settings(),warning=>warnings.push(warning));
  assert.deepEqual(out.filter(m=>m.memo!==C.MARK),input);
  assert.match(warnings[0],/이번 요청은 원문을 자르지 않고/);
  assert.match(warnings[0],/이미 제외한 원문은 복원하지 못/);
  assert.doesNotThrow(()=>C.inject(input,state,tl,C.settings({mode:'append'})));
});
test('source edit archives affected block and every dependent later block',async()=>{
  const {tl}=await stateWith();let state=C.commit(C.emptyState(),tl.turns.slice(0,5),'앞 기록');
  state=C.commit(state,tl.turns.slice(5,10),'뒤 기록');state.entries[0].text='사람이 수정';
  const r=raw(10,true);r[13].data='응답 변경';const next=C.reconcile(state,await C.timeline(r));
  assert.equal(next.entries.length,1);assert.equal(next.entries[0].text,'사람이 수정');
  assert.equal(next.archive[0].entries[0].text,'뒤 기록');assert.equal(state.entries.length,2);
});
test('identical fork can reuse backup; divergence never injects the old future',async()=>{
  const {state}=await stateWith();assert.equal(C.reconcile(state,await C.timeline(raw(10,true))).entries.length,1);
  const branch=raw(10,true);branch[1].data='다른 선택';const next=C.reconcile(state,await C.timeline(branch));
  assert.equal(C.memoryText(next),'');assert.equal(next.archive.length,1);
});
test('delete/regenerate a summarized reply invalidates it',async()=>{
  const {state}=await stateWith();const shorter=raw(4,true);
  assert.equal(C.reconcile(state,await C.timeline(shorter)).entries.length,0);
});
test('thought wrappers and incidental prefaces do not discard one complete valid final summary',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings();
  const data={from:1,to:5,title:'기록',keywords:['계약'],events:[{date:'',time:'',summary:'문서의 {중괄호}와 "인용"을 확인함.'}]},json=JSON.stringify(data);
  for(const wrapped of [`<Thoughts>추론 중 예시 ${JSON.stringify({...data,title:'생각 속 예시'})}</Thoughts>\n${json}`,`<think>분석</think>\n\`\`\`json\n${json}\n\`\`\``,`요약 결과:\n${json}\n완료.`]){
    const parsed=C.parseSummary(wrapped,batch,s);assert.equal(parsed.text,data.events[0].summary);
    assert.equal(parsed.title,'기록');assert(parsed.warnings.some(w=>w.includes('완성된 요약 JSON')));
  }
  const literal={...data,events:[{summary:'기록에 <think>문자열</think>을 적었다.'}]};
  assert.equal(C.parseSummary(JSON.stringify(literal),batch,s).text,literal.events[0].summary);
});
test('thought cleanup never accepts ambiguous, thought-only, truncated or wrong-range summaries',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings();
  const data={from:1,to:5,title:'기록',keywords:[],events:[{summary:'약속함.'}]},json=JSON.stringify(data);
  for(const bad of [`${json}\n${json}`,`<Thoughts>${json}</Thoughts>`,`<think>미완성 ${json}`,`설명\n${json.slice(0,-1)}`])assert.throws(()=>C.parseSummary(bad,batch,s));
  assert.throws(()=>C.parseSummary(`<Thoughts>분석</Thoughts>${JSON.stringify({...data,to:4})}`,batch,s),/턴 범위/);
});
test('chunk summary validates its range, calendar, metadata, and nonempty events',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings();
  const valid={from:1,to:5,title:'금화 수령',keywords:['영주','금화'],events:[{date:'1073-05-03',time:'저녁',summary:'금화 25개를 수령함.'}]};
  const parsed=C.parseSummary(JSON.stringify(valid),batch,s);
  assert.equal(parsed.title,'금화 수령');assert.equal(parsed.text,'1073.05.03. 저녁 — 금화 25개를 수령함.');
  assert.deepEqual(parsed.keywords,['영주','금화']);
  const invalid=[null,{...valid,to:4},{...valid,events:[]},
    {...valid,events:[{date:'',time:'',summary:''}]}];
  for(const value of invalid)assert.throws(()=>C.parseSummary(JSON.stringify(value),batch,s));
  assert.throws(()=>C.parseSummary('not json',batch,s));
  const unknown=C.parseSummary(JSON.stringify({...valid,events:[{date:'',time:'',summary:'계약함.'}]}),batch,s);
  assert.equal(unknown.text,'계약함.');
});
test('chunk character target is advisory even far beyond the former slack, without truncation',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings({charsPerTurn:100});
  const prefix='',response=n=>JSON.stringify({from:1,to:5,title:'분량 시험',keywords:[],events:[{date:'',time:'',summary:'가'.repeat(n-C.chars(prefix)-2)+'🪙2'}]});
  for(const n of [500,600,601,1500,12000]){
    const parsed=C.parseSummary(response(n),batch,s);
    assert.equal(C.chars(parsed.text),n);assert(parsed.text.endsWith('🪙2'));
    assert.equal(parsed.contentChars,n);assert.equal(parsed.targetChars,500);
    assert.equal(parsed.warnings.some(w=>w.includes('목표를 넘겼지만')),n>500);
  }
  assert.equal(C.summaryTarget(C.settings({charsPerTurn:200}),5),1000);
  const prompt=C.summaryPrompt(batch,s)[0].content;
  assert.match(prompt,/약 500글자/);assert.match(prompt,/강제 글자 상한이 아니다/);assert(!prompt.includes('최대 600'));
});
test('valid event lists beyond the former hidden event-count cap remain intact',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings();
  const events=Array.from({length:25},(_,i)=>({date:'',time:'',summary:`사건 ${i+1}: 약속을 확인함.`}));
  const parsed=C.parseSummary(JSON.stringify({from:1,to:5,title:'사건 모음',keywords:[],events}),batch,s);
  assert.equal(parsed.text.split('\n').length,25);assert(parsed.text.endsWith('사건 25: 약속을 확인함.'));
  assert.equal(parsed.contentChars,C.chars(events.map(e=>e.summary).join('\n')));
});
test('metadata variations preserve valid content, dates can be fictional or partial, and missing dates stay absent',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings();
  const make=(date,time='',extra={})=>JSON.stringify({from:1,to:5,title:'제목',keywords:['A'],events:[{date,time,summary:'약속을 확인함.'}],...extra});
  for(const date of ['',null,'미상','알 수 없음','none','?'])assert.equal(C.parseSummary(make(date),batch,s).text,'약속을 확인함.');
  for(const date of ['제국력 3년 봄','다음 날','1073.05','1073.02.30'])assert(C.parseSummary(make(date),batch,s).text.includes(date));
  assert.match(C.parseSummary(make('762-5-3','저녁'),batch,s).text,/762\.05\.03\./);
  const longTitle='제'.repeat(130),keywords=Array.from({length:14},(_,i)=>'인물'+i);
  const parsed=C.parseSummary(make('','',{title:longTitle,keywords}),batch,s);
  assert.equal(parsed.title,longTitle);assert.deepEqual(parsed.keywords,keywords);assert(parsed.warnings.length>0);
  const fallback=C.parseSummary(make('','',{title:null,keywords:null}),batch,s);
  assert.equal(fallback.text,'약속을 확인함.');assert(fallback.title);assert.deepEqual(fallback.keywords,[]);
});
test('display metadata does not consume the summary content allowance',async()=>{
  const batch=(await C.timeline(raw(5))).turns,s=C.settings();
  const data={from:1,to:5,title:'기록',keywords:[],events:[{date:'제국력 3년 봄',time:'해가 지기 직전',summary:'가'.repeat(600)}]};
  const parsed=C.parseSummary(JSON.stringify(data),batch,s);assert(C.chars(parsed.text)>600);assert(parsed.text.endsWith('가'.repeat(600)));
});
test('old source edits invalidate all dependent chunks even with unchanged tail messages and turn count',async()=>{
  const r=raw(30),tl=await C.timeline(r);let state=C.emptyState();
  for(let i=0;i<30;i+=5)state=C.commit(state,tl.turns.slice(i,i+5),'기록'+i);
  r[0].data='가장 오래된 첫 입력 수정';const changed=await C.timeline(r),next=C.reconcile(state,changed);
  assert.equal(changed.turns.length,tl.turns.length);assert.deepEqual(r.slice(-10),raw(30).slice(-10));assert.equal(next.entries.length,0);assert.equal(next.archive[0].entries.length,6);
});
test('invalid chat overrides fall back per field while valid overrides are honored',()=>{
  const s=C.settings({interval:10,recent:8}),resolved=C.chatSettings(s,{scriptstate:{
    $chronicle_enabled:'1',$chronicle_interval:'오타',$chronicle_recent:'0',$chronicle_chars:'180',$chronicle_mode:'invalid'
  }});
  assert.equal(resolved.interval,10);assert.equal(resolved.recent,8);assert.equal(resolved.charsPerTurn,180);
  assert.equal(resolved.enabled,true);assert.equal(resolved.mode,'standalone');assert.equal(resolved.settingWarnings.length,3);
  assert.throws(()=>C.settings({interval:0})); // Explicit plugin settings still validate before saving.
});
test('generic cleaning preserves structured state and custom tags without interpreting a bot schema',async()=>{
  const state='<status>{"name":"NPC","text":"<b>명시한 감정</b>","debt":18}</status>';
  const hre='<hre_state>{"journal_mode":"snapshot","public":{"name":"등장인물"}}</hre_state>';
  const source=[{role:'char',data:'<div>약속함.</div>\n'+state+'\n'+hre+'\n[HRE_IMG:N:1]{{image::asset}}',chatId:'a'}];
  const before=structuredClone(source),batch=[{number:1,messages:source}],s=C.settings();
  const content=C.summaryInput(batch,s)[0].messages[0].content;
  assert(content.includes(state));assert(content.includes(hre));assert(content.includes('[HRE_IMG:N:1]'));
  assert(!content.includes('{{image::'));assert(!content.includes('<div>'));assert.match(content,/약속함/);
  assert.deepEqual(source,before);assert.equal(C.summaryInput(batch,{...s,cleanSummaryInput:false})[0].messages[0].content,source[0].data);
  const prompt=C.summaryPrompt(batch,s)[0].content;
  assert(!prompt.includes('hre_state'));assert(!prompt.includes('public.name'));assert.match(prompt,/명시된 감정/);
});
test('malformed and unknown state markup remains intact; source hashes still detect decoration edits',async()=>{
  const source=[{role:'user',data:'행동',chatId:'u'},{role:'char',data:'<hre_state>{bad JSON}</hre_state><custom>은화 8</custom>[HRE_IMG:A:1]',chatId:'a'}];
  const tl=await C.timeline(source),rows=C.summaryInput(tl.turns,C.settings());
  assert.match(rows[0].messages[1].content,/<hre_state>\{bad JSON\}<\/hre_state>/);
  assert.match(rows[0].messages[1].content,/<custom>은화 8<\/custom>/);
  const oldHash=tl.turns[0].hash;source[1].data=source[1].data.replace('IMG:A:1','IMG:A:2');
  assert.notEqual((await C.timeline(source)).turns[0].hash,oldHash);
});
test('full accumulated log has no plugin character cap, including retired saved budget values',async()=>{
  const {state,tl}=await stateWith();state.entries[0].text='가'.repeat(50000);
  const out=C.inject(messages(raw(10,true)),state,tl,C.settings({memoryCharBudget:1000}));
  assert(out.find(m=>m.memo===C.MARK).content.includes(state.entries[0].text));assert.equal(state.entries[0].text.length,50000);
});
test('manual edits survive subsequent generation and validation',async()=>{
  const {state,tl}=await stateWith();state.entries[0].text='수정된 수량: 금화 25개';state.entries[0].editedAt='now';
  const next=C.commit(C.reconcile(state,tl),tl.turns.slice(5,10),'새 기록');
  assert.equal(next.entries[0].text,'수정된 수량: 금화 25개');assert.equal(next.entries.length,2);
});
test('corrupt/noncontiguous backups are rejected',async()=>{
  const {state}=await stateWith();state.entries[0].from=2;assert.throws(()=>C.validateState(state));
  assert.throws(()=>C.validateState({schema:2,entries:[],archive:[]}));
});
test('100-turn sequential simulation retains every block and recent verbatim input',async()=>{
  let state=C.emptyState();const s=C.settings();
  for(let n=1;n<=100;n++) {
    const tl=await C.timeline(raw(n,true));state=C.reconcile(state,tl);
    const batch=C.nextBatch(state,tl,s);
    if(batch.length) state=C.commit(state,batch,`T${batch[0].number}~T${batch.at(-1).number}: 완료`);
    const out=C.inject(messages(raw(n,true)),state,tl,s);
    const retainedIDs=new Set(out.map(m=>m.memo));
    for(let t=Math.max(1,n-4);t<=n;t++)assert(retainedIDs.has(`u${t}`));
    assert(retainedIDs.has(`u${n+1}`));
    for(const entry of state.entries)assert(C.memoryText(state).includes(entry.text));
  }
  assert.equal(state.entries.length,20);assert.equal(C.covered(state),100);assert.equal(state.archive.length,0);
});
test('portable prefix rebinds matching source IDs but stops before a divergent future',async()=>{
  const source=await C.timeline(raw(10));let state=C.commit(C.emptyState(),source.turns.slice(0,5),'共通記録');
  state=C.commit(state,source.turns.slice(5,10),'元の未来');
  const branch=raw(10).map(m=>({...m,chatId:'new-'+m.chatId}));branch[13].data='分岐した応答';
  const tl=await C.timeline(branch),restored=C.compatiblePrefix(state,tl);
  assert.equal(restored.entries.length,1);assert.equal(restored.entries[0].hash,tl.turns[4].hash);
  assert.notEqual(restored.entries[0].hash,state.entries[0].hash);assert.equal(C.reconcile(restored,tl).entries.length,1);
});
