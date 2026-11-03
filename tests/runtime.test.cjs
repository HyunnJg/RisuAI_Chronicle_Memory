// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const C=require('../core.cjs');
const P=require('../providers.cjs'),R=require('../retrieval.cjs'),S=require('../storage.cjs'),E=require('../platform.cjs');
const chunk=rows=>({from:rows[0].turn,to:rows.at(-1).turn,title:'임무 기록',keywords:['정찰','보상'],events:[{date:'1073.05.03',time:'저녁',summary:'정찰 임무의 보상 조건을 합의함.'}]});
function raw(n,pending=true){return Array.from({length:n},(_,i)=>[{role:'user',data:`입력${i+1}`,chatId:`u${i+1}`},{role:'char',data:`응답${i+1}`,chatId:`a${i+1}`}]).flat().concat(pending?[{role:'user',data:'다음',chatId:`u${n+1}`}]:[]);}
function formatted(r){return [{role:'system',content:'규칙'},...r.map(m=>({role:m.role==='char'?'assistant':'user',content:m.data,memo:m.chatId}))];}
async function setup(override={},change={}){
  const store=change.store||new Map([['risu-chronicle:v1:settings',JSON.stringify(C.settings({enabled:true,...override}))]]);
  const char={type:'character',chaId:'character-1',name:'테스트 캐릭터',chatPage:0,chats:[{id:'chat-1',name:'대화',message:raw(10)}]};
  const hooks={},calls=[],writes=[];let registrations=0;
  const api={pluginStorage:{getItem:async k=>store.get(k),setItem:async(k,v)=>{writes.push({key:k,value:v});store.set(k,v);},keys:async()=>[...store.keys()],removeItem:async k=>store.delete(k)},
    safeLocalStorage:{getItem:async key=>change.onCredential?change.onCredential(key,store):change.credentials?.[key]||null},getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>char.chatPage,
    getCharacter:async()=>structuredClone(char),addRisuReplacer:async(name,fn)=>{hooks[name]=fn;},
    registerSetting:async(_name,fn)=>{registrations++;hooks.open=fn;},registerButton:async()=>{registrations++;},
    runLLMModel:async opts=>{calls.push(opts);if(change.onCall) return change.onCall(opts,char);
      const data=JSON.parse(opts.messages[1].content);return {type:'success',result:JSON.stringify(chunk(data))};},
    nativeFetch:async(url,opts)=>{calls.push({url,opts});if(change.onFetch)return change.onFetch(url,opts,char);return change.externalResponse || new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(chunk([1,2,3,4,5].map(turn=>({turn}))))}}]}),{status:200});}
  };
  const sandbox={risuai:api,ChronicleCore:C,ChronicleProviders:P,ChronicleRetrieval:R,ChronicleStorage:S,ChroniclePlatform:{...E,assertMemory:()=>E.assertMemory('environment'in change?change.environment:globalThis)},structuredClone,TextEncoder,crypto:globalThis.crypto,
    setTimeout:change.timers?((fn,ms)=>{change.timers.push(ms);return setTimeout(fn,ms);}):setTimeout,clearTimeout,URL,Response,console,
    ...(change.document?{document:change.document}:{}),...(change.clock?{Date:change.clock}:{})};
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../runtime.js'),'utf8'),sandbox);
  return {store,char,hooks,calls,writes,registrations,getState:()=>JSON.parse(store.get('risu-chronicle:v1:chat:character-1:chat-1')||'null'),getRecall:()=>JSON.parse(store.get('risu-chronicle:v1:recall:character-1:chat-1')||'null'),getVectors:()=>JSON.parse(store.get('risu-chronicle:v1:vectors:character-1:chat-1')||'{"entries":{}}')};
}
test('plugin registers UI and main hook; auxiliary requests pass through',async()=>{
  const h=await setup();assert.equal(h.registrations,2);
  const input=formatted(raw(10));assert.equal(await h.hooks.beforeRequest(input,'memory'),input);assert.equal(h.calls.length,0);
});
test('summary credentials from another origin or an unbound legacy key never reach a network request',async()=>{
  for(const value of ['legacy-key',P.bindCredential('server-a-key','https://server-a.example/v1')]){
    const h=await setup({provider:'external',endpoint:'https://server-b.example/v1',model:'mock'},
      {credentials:{'risu-chronicle:v1:credential:external':value}});
    const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
    assert.equal(h.calls.length,0);assert.equal(C.covered(h.getState()),0);assert(out.some(m=>m.memo==='u1'));assert.match(h.getState().lastError,/주소/);
  }
});
test('dedicated embedding credentials cannot follow a changed embedding server',async()=>{
  const h=await setup({mode:'hybrid',embeddingProvider:'external',embeddingEndpoint:'https://server-b.example/v1',embeddingModel:'mock',embeddingReuseCredential:false},
    {credentials:{'risu-chronicle:v1:embedding-credential:external':P.bindCredential('embedding-a-key','https://server-a.example/v1',true)}});
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.calls.filter(c=>c.url).length,0);assert.equal(C.covered(h.getState()),5);assert(out.some(m=>m.memo===C.MARK));assert.match(h.getState().lastWarning,/주소/);
});
test('a summary uses the captured endpoint for key checks even if stored settings change during key lookup',async()=>{
  const h=await setup({provider:'external',endpoint:'https://server-a.example/v1',model:'mock'},
    {onCredential:async(key,store)=>{
      if(!key.endsWith('credential:external'))return null;
      const cfg=JSON.parse(store.get('risu-chronicle:v1:settings'));cfg.endpoint='https://server-b.example/v1';store.set('risu-chronicle:v1:settings',JSON.stringify(cfg));
      return P.bindCredential('server-a-key','https://server-a.example/v1');
    }});
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.calls.length,1);assert.equal(new URL(h.calls[0].url).origin,'https://server-a.example');assert.equal(h.calls[0].opts.headers.Authorization,'Bearer server-a-key');
});
test('unavailable Web Crypto skips memory visibly and keeps the exact RP input',async()=>{
  const h=await setup({}, {environment:{isSecureContext:false,crypto:{}}});const input=formatted(h.char.chats[0].message);
  assert.equal(await h.hooks.beforeRequest(input,'model'),input);assert.equal(h.calls.length,0);assert.equal(h.getState(),null);
  const health=JSON.parse(h.store.get('risu-chronicle:v1:health'));assert.equal(health.status,'skipped');assert.match(health.message,/HTTPS/);
  assert(h.writes.every(row=>!row.key.includes(':chat:')&&!row.key.includes(':vectors:')));
});
test('disabled memory passes through an unsupported browser without creating warnings or API calls',async()=>{
  const h=await setup({enabled:false},{environment:{crypto:{}}});const input=formatted(h.char.chats[0].message);
  assert.equal(await h.hooks.beforeRequest(input,'model'),input);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});
test('completed chunks survive a failed later batch and reload retries only the remaining chunk',async()=>{
  let calls=0;const first=await setup({batchesPerRequest:2},{onCall:async opts=>{
    calls++;return calls===2?{type:'fail',result:'temporary interruption'}:{type:'success',result:JSON.stringify(chunk(JSON.parse(opts.messages[1].content)))};
  }});
  await first.hooks.beforeRequest(formatted(first.char.chats[0].message),'model');const id=first.getState().entries[0].id;
  assert.equal(C.covered(first.getState()),5);assert.equal(JSON.parse(first.store.get('risu-chronicle:v1:health')).status,'warning');
  const resumed=await setup({}, {store:first.store});await resumed.hooks.beforeRequest(formatted(resumed.char.chats[0].message),'model');
  assert.equal(resumed.calls.length,1);assert.deepEqual(JSON.parse(resumed.calls[0].messages[1].content).map(row=>row.turn),[6,7,8,9,10]);
  assert.equal(C.covered(resumed.getState()),10);assert.equal(resumed.getState().entries[0].id,id);
  assert.equal(JSON.parse(resumed.store.get('risu-chronicle:v1:health')).status,'ok');
});
test('processing status is persisted while a summary is pending, without a timeout or duplicate call',async()=>{
  let finish,started;const began=new Promise(r=>started=r),release=new Promise(r=>finish=r);
  const h=await setup({}, {onCall:async opts=>{started();await release;return {type:'success',result:JSON.stringify(chunk(JSON.parse(opts.messages[1].content)))};}});
  const task=h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');await began;
  assert.equal(JSON.parse(h.store.get('risu-chronicle:v1:health')).status,'running');assert.equal(h.calls.length,1);
  finish();await task;assert.equal(JSON.parse(h.store.get('risu-chronicle:v1:health')).status,'ok');assert.equal(h.calls.length,1);
});
function waitDocument(){const listeners={};return {listeners,getElementById:()=>null,addEventListener:(name,fn)=>listeners[name]=fn};}
function controlled(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('manual wait stop releases queued RP, preserves raw and ignores a late summary',async()=>{
  const doc=waitDocument(),began=controlled(),reply=controlled();let now=Date.now();
  class Clock extends Date{static now(){return now;}}
  const h=await setup({}, {document:doc,clock:Clock,onCall:async opts=>{began.resolve();return reply.promise;}});
  const input=formatted(h.char.chats[0].message),first=h.hooks.beforeRequest(input,'model');await began.promise;
  const queued=h.hooks.beforeRequest(input,'model');doc.listeners.click({target:{id:'stopWait'}});
  const [a,b]=await Promise.all([first,queued]);
  assert(a.some(m=>m.memo==='u1'));assert(b.some(m=>m.memo==='u1'));assert.equal(h.getState().entries.length,0);assert.equal(h.calls.length,1);
  // Even after the normal error cooldown, a detached pending call is not duplicated.
  now+=61000;await h.hooks.beforeRequest(input,'model');assert.equal(h.calls.length,1);
  const snapshot=JSON.stringify(h.getState()),writes=h.writes.length;
  reply.resolve({type:'success',result:JSON.stringify(chunk([1,2,3,4,5].map(turn=>({turn}))))});
  await new Promise(r=>setImmediate(r));
  assert.equal(JSON.stringify(h.getState()),snapshot);assert.equal(h.writes.length,writes);
});
test('a stopped request rejecting late cannot write errors or block future summaries after cooldown',async()=>{
  const doc=waitDocument(),began=controlled(),reply=controlled();let now=Date.now(),n=0;
  class Clock extends Date{static now(){return now;}}
  const h=await setup({}, {document:doc,clock:Clock,onCall:async opts=>{
    if(++n===1){began.resolve();return reply.promise;}
    return {type:'success',result:JSON.stringify(chunk(JSON.parse(opts.messages[1].content)))};
  }});
  const input=formatted(h.char.chats[0].message),task=h.hooks.beforeRequest(input,'model');await began.promise;
  doc.listeners.click({target:{id:'stopWait'}});await task;const saved=JSON.stringify(h.getState());
  reply.reject(Error('late transport failure'));await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(h.getState()),saved);
  now+=61000;await h.hooks.beforeRequest(input,'model');assert.equal(n,2);assert.equal(C.covered(h.getState()),5);
});
test('stopping during Vertex authorization prevents a later model request from the abandoned task',async()=>{
  const {privateKey}=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048});
  const secret=JSON.stringify({type:'service_account',client_email:'stop-test@example.invalid',project_id:'test',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  const doc=waitDocument(),began=controlled(),reply=controlled();
  const h=await setup({provider:'vertex',model:'gemini-test',project:'test'},
    {document:doc,credentials:{'risu-chronicle:v1:credential:vertex':secret},onFetch:async()=>{began.resolve();return reply.promise;}});
  const task=h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');await began.promise;
  assert.match(h.calls[0].url,/oauth2/);doc.listeners.click({target:{id:'stopWait'}});await task;
  reply.resolve(new Response(JSON.stringify({access_token:'mock-token',expires_in:3600}),{status:200}));
  await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,1);assert.equal(C.covered(h.getState()),0);
});
test('stopping a later batch preserves a completed chunk and keeps the unfinished batch verbatim',async()=>{
  const doc=waitDocument(),began=controlled(),reply=controlled();let n=0;
  const h=await setup({batchesPerRequest:2},{document:doc,onCall:async opts=>{
    if(++n===2){began.resolve();return reply.promise;}
    return {type:'success',result:JSON.stringify(chunk(JSON.parse(opts.messages[1].content)))};
  }});
  const task=h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');await began.promise;
  const id=h.getState().entries[0].id;doc.listeners.click({target:{id:'stopWait'}});const out=await task;
  assert.equal(C.covered(h.getState()),5);assert.equal(h.getState().entries[0].id,id);
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u6'));
  reply.resolve({type:'success',result:JSON.stringify(chunk([6,7,8,9,10].map(turn=>({turn}))))});
  await new Promise(r=>setImmediate(r));assert.equal(C.covered(h.getState()),5);
});
test('stopping a hybrid embedding wait keeps summary state and falls back without committing late vectors',async()=>{
  const doc=waitDocument(),began=controlled(),reply=controlled();
  const h=await setup({mode:'hybrid',embeddingProvider:'openai',embeddingModel:'text-embedding-3-small',embeddingReuseCredential:false},
    {document:doc,credentials:{'risu-chronicle:v1:embedding-credential:openai':'test-key'},onFetch:async()=>{began.resolve();return reply.promise;}});
  const task=h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');await began.promise;
  doc.listeners.click({target:{id:'stopWait'}});const out=await task;
  assert.equal(C.covered(h.getState()),5);assert(out.some(m=>m.memo===C.MARK));assert.deepEqual(Object.keys(h.getVectors().entries),[]);
  const writes=h.writes.length;reply.resolve(new Response(JSON.stringify({data:[{index:0,embedding:[1,0]}]}),{status:200}));
  await new Promise(r=>setImmediate(r));assert.equal(h.writes.length,writes);assert.deepEqual(Object.keys(h.getVectors().entries),[]);
});
test('full-source guard detects a same-length early edit while the last message and count stay unchanged',async()=>{
  const h=await setup({}, {onCall:async(opts,char)=>{
    const old=char.chats[0].message[1].data;char.chats[0].message[1].data='변경1';assert.equal(old.length,'변경1'.length);
    return {type:'success',result:JSON.stringify(chunk(JSON.parse(opts.messages[1].content)))};
  }});
  await assert.rejects(()=>h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model'),/대화\/원문이 바뀌어/);
  assert.equal(h.getState().entries.length,0);
});
test('native submodel generates a chunk, injects it, and preserves recent raw',async()=>{
  const h=await setup();const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.calls[0].mode,'submodel');assert.equal(h.getState().entries.length,1);
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u6'));assert(out.some(m=>m.memo===C.MARK));
});
for(const mode of ['standalone','hybrid'])test(`${mode}: six normal turns followed by AI-only replies summarize 6–10 and retain the last five responses`,async()=>{
  const h=await setup({mode});
  const source=raw(6,false),initial=await C.timeline(source);
  const existing=C.commit(C.emptyState(),initial.turns.slice(0,5),'기존 1~5턴 수동 기록');
  h.store.set('risu-chronicle:v1:chat:character-1:chat-1',JSON.stringify(existing));
  h.char.chats[0].message=source;
  for(let n=7;n<=12;n++) {
    // Auto progression adds a reply without adding a stored user message.
    source.push({role:'char',data:`자동 진행 ${n}`,chatId:`a${n}`});
    const out=await h.hooks.beforeRequest(formatted(source),'model');
    assert(out.some(m=>m.memo===`a${n}`));
    if(n<10)assert.equal(h.calls.length,0);
  }
  assert.equal(h.calls.length,1);
  const batch=JSON.parse(h.calls[0].messages[1].content);
  assert.deepEqual(batch.map(t=>t.turn),[6,7,8,9,10]);
  assert.deepEqual(batch[1].messages.map(m=>m.role),['assistant']);
  const state=h.getState();assert.equal(state.entries.length,2);
  assert.equal(state.entries[0].id,existing.entries[0].id);assert.equal(state.entries[0].text,'기존 1~5턴 수동 기록');
  assert.deepEqual(state.entries.map(e=>[e.from,e.to]),[[1,5],[6,10]]);
  const out=await h.hooks.beforeRequest(formatted(source),'model');
  assert.equal(h.calls.length,1);assert(!out.some(m=>m.memo==='a7'));
  for(let n=8;n<=12;n++)assert(out.some(m=>m.memo===`a${n}`));
  assert(out.find(m=>m.memo===C.MARK).content.includes('기존 1~5턴 수동 기록'));
  source.find(m=>m.chatId==='a9').data='수정한 자동 진행';
  await h.hooks.beforeRequest(formatted(source),'model');
  assert.equal(h.calls.length,2);assert.equal(h.getState().archive.length,1);
  assert.equal(h.getState().entries[0].id,existing.entries[0].id);
});
test('main-model selection uses a separate native call',async()=>{
  const h=await setup({provider:'main'});await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.equal(h.calls[0].mode,'model');
});
for(const scope of ['all','recent','none'])test(`Risu cooperation ${scope}: summary reads full saved history, preserves native input, and makes no automatic embedding calls`,async()=>{
  const h=await setup({...hybridRisuSettings(),risuLogScope:scope,batchesPerRequest:2});
  const original=structuredClone(h.char.chats[0].message);
  const incoming=[{role:'system',content:'카드 규칙'},
    {role:'system',content:'<Past Events Summary>하이파가 선택한 과거</Past Events Summary>',memo:'supaMemory'},
    {role:'assistant',content:'Risu가 남긴 최근 응답',memo:'a10',cachePoint:true},
    {role:'user',content:'현재 입력',memo:'u11',multimodals:[{type:'image',base64:'test'}]}];
  const out=await h.hooks.beforeRequest(incoming,'model'),state=h.getState();
  assert.deepEqual(out.filter(m=>m.memo!==C.MARK),incoming);assert.deepEqual(h.char.chats[0].message,original);
  assert.equal(state.entries.length,2);assert.equal(state.lastWarning||'','');
  assert.equal(h.calls.length,2);assert(h.calls.every(c=>!c.url));
  assert.deepEqual(h.calls.map(c=>JSON.parse(c.messages[1].content).map(t=>t.turn)),[[1,2,3,4,5],[6,7,8,9,10]]);
  assert(h.calls.every(c=>c.messages[0].content.includes('약 150글자')));
  assert.equal(state.lastSummaryInput.summaryTargetChars,150);
  const text=out.find(m=>m.memo===C.MARK)?.content||'';
  assert.equal(text.includes('(1–5턴)'),scope==='all');assert.equal(text.includes('(6–10턴)'),scope!=='none');
  assert(!out.some(m=>m.memo===C.MARK+'-recall'));assert.equal(h.getRecall(),null);
  await h.hooks.beforeRequest(out,'model');assert.equal(h.calls.length,2);
});
function hybridRisuSettings(){return {mode:'risu',risuCharsPerTurn:30,risuRecentChunks:1,embeddingProvider:'external',embeddingEndpoint:'https://must-not-call.example/v1',embeddingModel:'saved-embedding'};}
test('Risu cooperation failure leaves native input intact without fabricating missing source messages',async()=>{
  const h=await setup(hybridRisuSettings(),{onCall:async()=>({type:'fail',result:'summary failed'})});
  const incoming=[{role:'system',memo:'supaMemory',content:'하이파 기억'},{role:'user',content:'Risu 현재 입력'}];
  const out=await h.hooks.beforeRequest(incoming,'model');
  assert.deepEqual(out,incoming);assert.equal(h.getState().entries.length,0);assert(h.getState().lastError);
  assert.equal(h.calls.length,1);assert(!h.calls[0].url);
});
test('native thought-wrapped final JSON commits turns 16–20 without losing native memory or storing reasoning',async()=>{
  const h=await setup({mode:'risu'},{onCall:async opts=>{
    const rows=JSON.parse(opts.messages[1].content);
    return {type:'success',result:`<Thoughts>MODEL_REASONING_ONLY</Thoughts>\n${JSON.stringify(chunk(rows))}`};
  }});
  h.char.chats[0].message=raw(20);const tl=await C.timeline(h.char.chats[0].message);let state=C.emptyState();
  for(let n=0;n<15;n+=5)state=C.commit(state,tl.turns.slice(n,n+5),`기존 ${n+1}~${n+5} 기록`);
  const ids=state.entries.map(e=>e.id);h.store.set('risu-chronicle:v1:chat:character-1:chat-1',JSON.stringify(state));
  const input=[{role:'system',memo:'supaMemory',content:'하이파 기억'},{role:'user',content:'현재 요청'}];
  const out=await h.hooks.beforeRequest(input,'model'),saved=h.getState();
  assert.equal(C.covered(saved),20);assert.equal(saved.entries.length,4);assert.equal(saved.lastError,'');
  assert.deepEqual(saved.entries.slice(0,3).map(e=>e.id),ids);assert.equal(h.calls.length,1);
  assert(saved.summaryWarnings.some(w=>w.includes('추론 표시')));
  assert(!JSON.stringify(saved).includes('MODEL_REASONING_ONLY'));assert(!JSON.stringify(out).includes('MODEL_REASONING_ONLY'));
  assert.deepEqual(out.filter(m=>m.memo!==C.MARK),input);
});
test('switching into Risu cooperation preserves old manual logs and switching back restores local raw management',async()=>{
  const h=await setup();
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const key='risu-chronicle:v1:chat:character-1:chat-1',state=h.getState();state.entries[0].text='기존 수동 기록은 재압축하지 않는다';
  h.store.set(key,JSON.stringify(state));
  h.store.set('risu-chronicle:v1:settings',JSON.stringify(C.settings({...hybridRisuSettings(),enabled:true})));
  const input=formatted(h.char.chats[0].message),out=await h.hooks.beforeRequest(input,'model');
  assert(out.some(m=>m.memo==='u1'));assert.equal(h.getState().entries[0].id,state.entries[0].id);
  assert.equal(h.getState().entries[0].text,state.entries[0].text);assert.equal(h.getState().entries.length,2);
  h.store.set('risu-chronicle:v1:settings',JSON.stringify(C.settings({enabled:true})));
  const local=await h.hooks.beforeRequest(input,'model');assert(!local.some(m=>m.memo==='u1'));assert(local.some(m=>m.memo==='u6'));
  assert.equal(h.calls.length,2);assert.equal(h.getState().entries[0].text,state.entries[0].text);
});
for(const mode of ['standalone','hybrid'])test(`${mode}: an oversized valid summary advances memory and applies the recent-raw window without retrying`,async()=>{
  const h=await setup({mode},{onCall:async opts=>{
    const rows=JSON.parse(opts.messages[1].content);
    return {type:'success',result:JSON.stringify({...chunk(rows),events:Array.from({length:25},(_,i)=>({date:'',time:'',summary:`사건${i}: `+'정보'.repeat(100)}))})};
  }});
  const original=structuredClone(h.char.chats[0].message),tl=await C.timeline(original);
  const existing=C.commit(C.emptyState(),tl.turns.slice(0,5),'기존 수동 기록');
  h.store.set('risu-chronicle:v1:chat:character-1:chat-1',JSON.stringify(existing));
  const out=await h.hooks.beforeRequest(formatted(original),'model'),state=h.getState();
  assert.equal(state.entries.length,2);assert.equal(state.entries[0].id,existing.entries[0].id);
  assert.equal(C.covered(state),10);assert.equal(state.lastError,'');
  assert(state.entries[1].text.endsWith('정보'.repeat(100)));assert(state.entries[1].text.includes('사건24:'));
  assert(state.summaryWarnings.some(w=>w.includes('목표를 넘겼지만')));
  assert(state.lastSummaryInput.summaryChars>5000);assert.equal(state.lastSummaryInput.summaryTargetChars,500);
  assert(!out.some(m=>m.memo==='u1'));assert(!out.some(m=>m.memo==='a5'));
  for(let n=6;n<=10;n++){assert(out.some(m=>m.memo===`u${n}`));assert(out.some(m=>m.memo===`a${n}`));}
  assert(out.some(m=>m.memo==='u11'));assert(out.find(m=>m.memo===C.MARK).content.includes('사건24:'));
  assert.deepEqual(h.char.chats[0].message,original);
  await h.hooks.beforeRequest(formatted(original),'model');assert.equal(h.calls.length,1);
});
test('failed model preserves all original raw and records no covered chunk',async()=>{
  const h=await setup({}, {onCall:async()=>({type:'fail',result:'error'})});
  const input=formatted(h.char.chats[0].message),out=await h.hooks.beforeRequest(input,'model');
  assert.deepEqual(out,input);assert.equal(h.getState().entries.length,0);assert.match(h.getState().lastError,/호출 실패/);
  await h.hooks.beforeRequest(input,'model');assert.equal(h.calls.length,1); // Retry cooldown.
});
test('source changes during model call discard generated summary',async()=>{
  const h=await setup({}, {onCall:async(opts,char)=>{char.chats[0].message[0].data='수정됨';return {type:'success',result:JSON.stringify(chunk([1,2,3,4,5].map(turn=>({turn}))))};}});
  await assert.rejects(()=>h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model'),/원문이 바뀌/);
  assert.equal(h.getState().entries.length,0);
});
test('external API sends selected output cap and parses successful response',async()=>{
  const h=await setup({provider:'external',endpoint:'https://example.org/v1/chat/completions',model:'example-model',tokenField:'max_completion_tokens'});
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const body=JSON.parse(h.calls[0].opts.body);assert.equal(body.max_completion_tokens,500);assert.equal(body.stream,false);assert.equal(h.getState().entries.length,1);
  assert(!('memo' in body.messages[0]));
});
test('external truncated output does not advance memory cursor',async()=>{
  const h=await setup({provider:'external',endpoint:'https://example.org/v1/chat/completions',model:'m'},
    {externalResponse:new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"events":['}}]}),{status:200})});
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.equal(h.getState().entries.length,0);assert(out.some(m=>m.memo==='u1'));
});
test('disabled plugin leaves original request unchanged and makes no model call',async()=>{
  const h=await setup({enabled:false});const input=formatted(h.char.chats[0].message);
  assert.equal(await h.hooks.beforeRequest(input,'model'),input);assert.equal(h.calls.length,0);
});
test('module can enable one chat and override batch size while global default is disabled',async()=>{
  const h=await setup({enabled:false});h.char.chats[0].scriptstate={$chronicle_enabled:'1',$chronicle_interval:'10'};
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.getState().entries[0].to,10);assert.equal(h.calls.length,1);
});
test('legacy append migrates to hybrid, trims recent raw, and warns about the changed mode',async()=>{
  const h=await setup({mode:'append',recent:5});const input=formatted(h.char.chats[0].message);
  const out=await h.hooks.beforeRequest(input,'model');
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u6'));
  assert.match(h.getState().lastWarning,/이전 추가 주입 모드/);
  const rows=JSON.parse(h.calls[0].messages[1].content);
  assert.deepEqual(rows.map(t=>t.turn),[1,2,3,4,5]);
  assert.equal(rows[0].context.botCardName,'테스트 캐릭터');
});
test('invalid module numbers do not abort RP and warnings persist for the settings screen',async()=>{
  const h=await setup({interval:10});h.char.chats[0].scriptstate={$chronicle_interval:'oops',$chronicle_recent:'100'};
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.getState().entries[0].to,10);assert(out.some(m=>m.memo===C.MARK));
  assert.match(h.getState().lastWarning,/chronicle_interval/);assert.match(h.getState().lastWarning,/chronicle_recent/);
  delete h.char.chats[0].scriptstate;
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.equal(h.getState().lastWarning,'');
});
test('missing request IDs allow RP to continue with incoming raw preserved and a saved warning',async()=>{
  const h=await setup();const input=formatted(h.char.chats[0].message);delete input.at(-1).memo;
  const out=await h.hooks.beforeRequest(input,'model');
  assert.deepEqual(out.filter(m=>m.memo!==C.MARK),input);assert.match(h.getState().lastWarning,/원문을 자르지 않고/);
  assert.equal(h.getState().lastSummaryInput.to,5);assert(h.getState().lastSummaryInput.seconds>=0);
});
test('old summary timeout settings are ignored and no plugin deadline is scheduled',async()=>{
  for(const seconds of [180,240]) {
    const timers=[],h=await setup(seconds===180?{}:{summaryTimeoutSeconds:seconds},{timers});
    await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.deepEqual(timers,[]);
  }
});
test('concurrent main requests serialize without duplicating chunks',async()=>{
  const h=await setup();const input=formatted(h.char.chats[0].message);
  await Promise.all([h.hooks.beforeRequest(input,'model'),h.hooks.beforeRequest(input,'model')]);
  assert.equal(h.getState().entries.length,2);assert.equal(h.calls.length,2);
  assert.deepEqual(h.getState().entries.map(e=>[e.from,e.to]),[[1,5],[6,10]]);
});
test('returning to a previous chat reuses its edited stored memory without JSON',async()=>{
  const h=await setup();await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const key='risu-chronicle:v1:chat:character-1:chat-1',saved=JSON.parse(h.store.get(key));
  saved.entries[0].text='수동 편집 기록';h.store.set(key,JSON.stringify(saved));
  h.char.chats.push({id:'other-chat',message:raw(2)});h.char.chatPage=1;
  await h.hooks.beforeRequest(formatted(h.char.chats[1].message),'model');h.char.chatPage=0;
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert(out.some(m=>m.content.includes('수동 편집 기록')));assert.equal(h.getState().entries.length,2);
});
test('new branch automatically restores matching content even when message IDs change',async()=>{
  const h=await setup();await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const branch=raw(5).map(m=>({...m,chatId:'branch-'+m.chatId}));
  h.char.chats.push({id:'branch',name:'분기',message:branch});h.char.chatPage=1;
  const out=await h.hooks.beforeRequest(formatted(branch),'model');
  const saved=JSON.parse(h.store.get('risu-chronicle:v1:chat:character-1:branch'));
  assert.equal(h.calls.length,1);assert.equal(saved.entries[0].to,5);assert.equal(saved.restoredFrom.automatic,true);
  assert(out.some(m=>m.memo===C.MARK));
});
test('unrelated chat and different character never inherit cached memory',async()=>{
  const h=await setup();await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const other=raw(2);other[0].data='전혀 다른 이야기';h.char.chats.push({id:'different',message:other});h.char.chatPage=1;
  let out=await h.hooks.beforeRequest(formatted(other),'model');assert(!out.some(m=>m.memo===C.MARK));
  h.char.chaId='character-2';h.char.chats[1]={id:'same-content',message:raw(5)};
  await h.hooks.beforeRequest(formatted(raw(5)),'model');assert.equal(h.calls.length,2);
  const saved=JSON.parse(h.store.get('risu-chronicle:v1:chat:character-2:same-content'));assert(!saved.restoredFrom);
});
test('automatic branch reuse can be disabled without disabling ordinary per-chat persistence',async()=>{
  const h=await setup({autoRestoreCache:false});await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  h.char.chats.push({id:'branch',message:raw(5)});h.char.chatPage=1;
  await h.hooks.beforeRequest(formatted(raw(5)),'model');assert.equal(h.calls.length,2);
});
test('legacy cached entries gain portable content hashes when their original chat is opened',async()=>{
  const h=await setup();await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const key='risu-chronicle:v1:chat:character-1:chat-1',legacy=JSON.parse(h.store.get(key));
  delete legacy.entries[0].contentHash;delete legacy.cacheMeta;h.store.set(key,JSON.stringify(legacy));
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.match(JSON.parse(h.store.get(key)).entries[0].contentHash,/^[a-f0-9]{64}$/);
  h.char.chats.push({id:'migrated-branch',message:raw(5).map(m=>({...m,chatId:'new-'+m.chatId}))});h.char.chatPage=1;
  await h.hooks.beforeRequest(formatted(h.char.chats[1].message),'model');assert.equal(h.calls.length,2);
});
const hybridConfig={mode:'hybrid',embeddingProvider:'external',embeddingEndpoint:'https://embedding.example/v1',embeddingModel:'test-embed'};
const embeddingResponse=opts=>new Response(JSON.stringify({data:JSON.parse(opts.body).input.map((text,index)=>({index,embedding:[1,0]}))}));
test('first chunk reports completed indexing and skipped duplicate search without a query call, then searches when it ages out',async()=>{
  const h=await setup(hybridConfig,{onFetch:async(url,opts)=>embeddingResponse(opts)});
  h.char.chats[0].message=raw(5);
  const first=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model'),info=h.getRecall();
  assert.equal(info.indexed,1);assert.equal(info.total,1);
  assert.equal(info.method,'skipped');assert.equal(info.reason,'recent-raw');assert.equal(info.selected.length,0);
  assert.equal(h.calls.filter(c=>c.url).length,1); // Document only; query is unnecessary.
  assert(first.some(m=>m.memo===C.MARK));assert(!first.some(m=>m.memo===C.MARK+'-recall'));
  for(let n=1;n<=5;n++)assert(first.some(m=>m.memo===`a${n}`));
  h.char.chats[0].message=raw(6);
  const second=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.calls.filter(c=>c.url).length,2); // One query, same document index.
  assert.equal(h.getRecall().method,'semantic+keyword');assert.equal(h.getRecall().reason,'');
  assert(second.some(m=>m.memo===C.MARK+'-recall'));
});
test('hybrid embeds chunks once, reuses the query cache, and never reinjects old raw',async()=>{
  const h=await setup(hybridConfig,{onFetch:async(url,opts)=>embeddingResponse(opts)});
  h.char.chats[0].message.at(-1).data='정찰 보상을 요구한다.';
  let input=formatted(h.char.chats[0].message),out=await h.hooks.beforeRequest(input,'model');
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u6'));
  assert.equal(out.at(-2).memo,C.MARK+'-recall');assert.equal(out.at(-1).memo,'u11');
  assert.match(out.at(-2).content,/임무 기록 \(1–5턴\)/);assert.equal(h.getRecall().method,'semantic+keyword');
  const firstHash=h.getVectors().entries[h.getState().entries[0].id].hash;
  assert.equal(h.calls.filter(c=>c.url).length,2); // Document + query.
  out=await h.hooks.beforeRequest(input,'model');
  assert.equal(h.calls.filter(c=>c.url).length,3); // Only newly summarized chunk is embedded.
  assert.equal(h.getVectors().entries[h.getState().entries[0].id].hash,firstHash);assert.equal(h.getState().entries.length,2);
  assert.equal(out.filter(m=>m.memo===C.MARK+'-recall').length,1);
  const main=out.find(m=>m.memo===C.MARK);assert.match(main.content,/1–5턴/);assert.match(main.content,/6–10턴/);
});
test('embedding failure falls back to keywords with cooldown while preserving log and recent raw',async()=>{
  const h=await setup(hybridConfig,{onFetch:async()=>new Response(JSON.stringify({error:{message:'service unavailable'}}),{status:503})});
  h.char.chats[0].message.at(-1).data='정찰 보상';
  let out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.getState().entries.length,1);assert.match(h.getState().lastWarning,/임베딩 검색 실패/);
  assert.equal(h.getRecall().method,'keyword');assert.equal(h.getRecall().reason,'embedding-error');assert(out.some(m=>m.memo===C.MARK+'-recall'));assert(out.some(m=>m.memo==='u11'));
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.equal(h.calls.filter(c=>c.url).length,1);
  assert.equal(h.getRecall().reason,'retry-wait');
});
test('edited summary and changed embedding model invalidate vectors without rewriting previous summaries',async()=>{
  const h=await setup(hybridConfig,{onFetch:async(url,opts)=>embeddingResponse(opts)}),key='risu-chronicle:v1:chat:character-1:chat-1';
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const state=h.getState(),oldHash=h.getVectors().entries[state.entries[0].id].hash;state.entries[0].text='수동 편집: 지급받은 금화는 25개.';h.store.set(key,JSON.stringify(state));
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.notEqual(h.getVectors().entries[h.getState().entries[0].id].hash,oldHash);
  assert.match(h.getState().entries[0].text,/금화는 25개/);
  const oldSignature=h.getVectors().entries[h.getState().entries[0].id].signature;
  h.store.set('risu-chronicle:v1:settings',JSON.stringify(C.settings({enabled:true,...hybridConfig,embeddingModel:'different-embed'})));
  const nativeCalls=h.calls.filter(c=>!c.url).length;
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.notEqual(h.getVectors().entries[h.getState().entries[0].id].signature,oldSignature);
  assert.equal(h.calls.filter(c=>!c.url).length,nativeCalls);assert.match(h.getState().entries[0].text,/금화/);
});
test('standalone and disabled modes never call embeddings even with a saved embedding model',async()=>{
  for(const override of [{mode:'standalone'},{enabled:false}]){
    const h=await setup({...hybridConfig,...override},{onFetch:async()=>{throw Error('Embedding must not run');}});
    await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');assert.equal(h.calls.filter(c=>c.url).length,0);
  }
});
test('embedding completion after a chat switch is discarded and never injected into another chat',async()=>{
  const h=await setup(hybridConfig,{onFetch:async(url,opts,char)=>{char.chats.push({id:'other',message:raw(2)});char.chatPage=1;return embeddingResponse(opts);}});
  await assert.rejects(()=>h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model'),/대화\/원문이 바뀌/);
  assert(!h.store.has('risu-chronicle:v1:chat:character-1:other'));assert(!h.getState().entries[0].embedding);
});
test('retired module timeout is ignored while generic input cleaning remains configurable',async()=>{
  const timers=[],h=await setup({}, {timers});h.char.chats[0].scriptstate={$chronicle_timeout:'300',$chronicle_clean:'0'};
  h.char.chats[0].message[1].data='본문[HRE_IMG:N:1]';
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.deepEqual(timers,[]);assert.match(h.calls[0].messages[1].content,/HRE_IMG/);
});
test('a chunk crossing the recent-raw boundary remains searchable for its older events',async()=>{
  const h=await setup(hybridConfig,{onFetch:async(url,opts)=>embeddingResponse(opts)});
  h.char.chats[0].message=raw(7);h.char.chats[0].message.at(-1).data='정찰 보상';
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert(!out.some(m=>m.memo==='u1'));assert(out.some(m=>m.memo==='u3'));
  assert.equal(h.getRecall().selected[0].from,1);assert(out.some(m=>m.memo===C.MARK+'-recall'));
});
test('vector dimensions cannot be mixed when a backend changes a model under the same ID',async()=>{
  let dimension=2;const h=await setup(hybridConfig,{onFetch:async(url,opts)=>{
    const input=JSON.parse(opts.body).input;return new Response(JSON.stringify({data:input.map((text,index)=>({index,embedding:Array.from({length:dimension},(_,i)=>i===0?1:0)}))}));
  }});
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  dimension=3;h.char.chats[0].message.at(-1).data='다른 정찰 보상 질문';
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.match(h.getState().lastWarning,/차원이 바뀌었/);assert.equal(Object.keys(h.getVectors().entries).length,0);
  assert.equal(h.getRecall().method,'keyword');assert(out.some(m=>m.memo==='u11'));
});
test('Voyage always uses its dedicated credential and sends document/query tasks during real hook flow',async()=>{
  const h=await setup({mode:'hybrid',embeddingProvider:'voyage',embeddingModel:'voyage-4-large',embeddingReuseCredential:true},
    {credentials:{'risu-chronicle:v1:embedding-credential:voyage':'VOYAGE_ONLY_TEST_KEY','risu-chronicle:v1:credential:external':'UNRELATED_TEST_KEY'},
      onFetch:async(url,opts)=>embeddingResponse(opts)});
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model'),requests=h.calls.filter(c=>c.url);
  assert.equal(requests.length,2);
  assert.deepEqual(requests.map(r=>JSON.parse(r.opts.body).input_type),['document','query']);
  for(const request of requests)assert.equal(request.opts.headers.Authorization,'Bearer VOYAGE_ONLY_TEST_KEY');
  assert.equal(h.getRecall().method,'semantic+keyword');assert(out.some(m=>m.memo===C.MARK+'-recall'));
});
test('unsupported group chats pass through even when Chronicle is globally enabled',async()=>{
  for(const enabled of [true,false]){
    const h=await setup({enabled});h.char.type='group';const input=formatted(raw(10));
    assert.equal(await h.hooks.beforeRequest(input,'model'),input);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
  }
});
test('corrupt or invalid saved settings do not block RP or overwrite the damaged configuration',async()=>{
  for(const value of ['{bad json',JSON.stringify({enabled:false,interval:0}),JSON.stringify({profiles:'broken'})]){
    const h=await setup(),key='risu-chronicle:v1:settings';h.store.set(key,value);const input=formatted(raw(10));
    assert.equal(await h.hooks.beforeRequest(input,'model'),input);assert.equal(h.calls.length,0);assert.equal(h.store.get(key),value);
  }
});
test('external credential reuse never sends a saved key to a different origin',async()=>{
  const credentials={'risu-chronicle:v1:credential:external':P.bindCredential('SERVER_A_KEY','https://server-a.example/v1')};
  const h=await setup({...hybridConfig,profiles:{external:{endpoint:'https://server-a.example/v1'}}},{credentials,onFetch:async()=>{throw Error('No request may carry this key to server B');}});
  const out=await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.calls.filter(c=>c.url).length,0);assert.match(h.getState().lastWarning,/origin/);assert(out.some(m=>m.memo===C.MARK));
  const same=await setup({...hybridConfig,profiles:{external:{endpoint:'https://embedding.example/chat-api/v1'}}},{credentials:{'risu-chronicle:v1:credential:external':P.bindCredential('SERVER_A_KEY','https://embedding.example/v1')},onFetch:async(url,opts)=>embeddingResponse(opts)});
  await same.hooks.beforeRequest(formatted(same.char.chats[0].message),'model');
  assert(same.calls.filter(c=>c.url).every(c=>c.opts.headers.Authorization==='Bearer SERVER_A_KEY'));assert.equal(same.getRecall().method,'semantic+keyword');
});
test('query changes write no full narrative or vector store once the chunks are indexed',async()=>{
  const h=await setup(hybridConfig,{onFetch:async(url,opts)=>embeddingResponse(opts)});
  for(let i=0;i<2;i++)await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  h.writes.length=0;h.char.chats[0].message.at(-1).data='보상 약속을 다시 확인한다.';
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert(h.writes.every(row=>!row.key.includes(':chat:')&&!row.key.includes(':vectors:')));
  assert(!C.hasDerivedState(h.getState()));assert.equal(Object.keys(h.getVectors().entries).length,2);
  for(const value of h.store.values())assert(!String(value).includes('"queryEmbedding"'));
});
test('legacy inline vectors migrate without re-summarizing, and archives no longer contain vectors',async()=>{
  const h=await setup(),key='risu-chronicle:v1:chat:character-1:chat-1';
  await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  const legacy=h.getState(),e=legacy.entries[0],hash=await C.digest(R.document(e));
  e.embedding={signature:'old-model',hash,vector:[1,0]};
  legacy.archive=[{entries:[{...structuredClone(e)}],previousArchive:[{entries:[structuredClone(e)]}]}];
  legacy.queryEmbedding={signature:'old-model',hash:'query',vector:[1,0]};
  legacy.lastRecall={selected:[],text:'',indexed:1,total:1};
  h.store.set(key,JSON.stringify(legacy));h.char.chats[0].message=raw(5);
  const nativeCalls=h.calls.length;await h.hooks.beforeRequest(formatted(h.char.chats[0].message),'model');
  assert.equal(h.calls.length,nativeCalls);assert(!C.hasDerivedState(h.getState()));
  assert.deepEqual(h.getVectors().entries[e.id].vector,[1,0]);assert.equal(h.getState().entries[0].text,e.text);
});
