// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
// Measures one beforeRequest call on synthetic 300/500-turn chats in Node (no browser, no host bridge).
// Usage: node bench/before_request.cjs [runs]
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{performance}=require('node:perf_hooks');
const C=require('../core.cjs'),P=require('../providers.cjs'),R=require('../retrieval.cjs'),S=require('../storage.cjs'),E=require('../platform.cjs'),L=require('../lifecycle.cjs');
const RUNS=Number(process.argv[2]||20);
const line=(n,who)=>`${who} ${n}: `+'그녀는 창밖을 보며 어제의 약속과 시장의 소문을 천천히 되짚었다. '.repeat(8);
function raw(turns){const out=[];for(let i=1;i<=turns;i++)out.push({role:'user',data:line(i,'입력'),chatId:`u${i}`},{role:'char',data:line(i,'응답'),chatId:`a${i}`});out.push({role:'user',data:'시장 약속을 확인한다.',chatId:`u${turns+1}`});return out;}
async function harness(turns,mode,saved=null){
  const store=saved||new Map([['risu-chronicle:v1:settings',JSON.stringify(C.settings({enabled:true,mode,batchesPerRequest:20,embeddingModel:''}))]]);
  const char={type:'character',chaId:'bench',name:'벤치',chatPage:0,chats:[{id:'chat',name:'대화',message:raw(turns)}]};
  let hook,getCharacter=0;
  const api={pluginStorage:{getItem:async k=>store.get(k),setItem:async(k,v)=>store.set(k,v),keys:async()=>[...store.keys()],removeItem:async k=>store.delete(k)},
    safeLocalStorage:{getItem:async()=>null},getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getCharacter:async()=>{getCharacter++;return structuredClone(char);},addRisuReplacer:async(_n,fn)=>{hook=fn;},registerSetting:async()=>{},registerButton:async()=>{},
    runLLMModel:async opts=>{const data=JSON.parse(opts.messages[1].content),rows=Array.isArray(data)?data:data.turns;
      return {type:'success',result:JSON.stringify({from:rows[0].turn,to:rows.at(-1).turn,title:'기록',keywords:['시장','약속'],events:[{summary:'시장에서 다시 만나기로 약속함. '.repeat(10)}]})};}};
  let start;
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../runtime.js'),'utf8'),{risuai:api,ChronicleCore:C,ChronicleProviders:P,ChronicleRetrieval:R,ChronicleStorage:S,ChronicleLifecycle:L,ChroniclePlatform:E,
    structuredClone,TextEncoder,crypto:globalThis.crypto,setTimeout:fn=>{start=fn;return 1;},clearTimeout:()=>{},URL,Response,console});
  await start();
  const messages=[{role:'system',content:'규칙'},...char.chats[0].message.map(m=>({role:m.role==='char'?'assistant':'user',content:m.data,memo:m.chatId}))];
  let covered=saved?turns:0;for(let i=0;i<20&&covered<turns;i++){await hook(messages,'model');covered=C.covered(JSON.parse(store.get('risu-chronicle:v1:chat:bench:chat')));}
  return {char,messages,hook,store,calls:()=>getCharacter,covered};
}
const stats=list=>{const sorted=[...list].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length/2)],p90:sorted[Math.floor(sorted.length*0.9)],max:sorted.at(-1)};};
(async()=>{
  console.log(`node ${process.version} · ${process.platform} ${process.arch} · runs=${RUNS}`);
  for(const turns of [300,500])for(const mode of ['standalone','hybrid']){
    const h=await harness(turns,mode);
    if(h.covered!==turns)throw Error(`setup covered ${h.covered}/${turns}`);
    const warm=[];let perCall=0;
    for(let i=0;i<RUNS;i++){const before=h.calls(),t=performance.now();await h.hook(h.messages,'model');warm.push(performance.now()-t);perCall=h.calls()-before;}
    // Cold: first request after a reload — saved memory, but no in-memory timeline hash cache.
    const cold=await harness(turns,mode,new Map(h.store)),t=performance.now();await cold.hook(cold.messages,'model');const coldMs=performance.now()-t;
    const w=stats(warm),fmt=n=>n.toFixed(1);
    console.log(`${turns} turns · ${mode.padEnd(10)} · warm median ${fmt(w.median)}ms p90 ${fmt(w.p90)}ms max ${fmt(w.max)}ms · cold (first after reload) ${fmt(coldMs)}ms · getCharacter ${perCall}/request · chat ${(JSON.stringify(h.char).length/1024).toFixed(0)}KB`);
  }
})().catch(e=>{console.error(e);process.exit(1);});
