// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
// Minimal DOM for interaction/structure checks, not a browser rendering or layout test.
function documentMock() {
  const ids=new Map(),all=[],listeners=new Map();
  class Element {
    constructor(tag='div'){this.tagName=tag;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.dataset={};this.textContent='';this.children=[];all.push(this);}
    appendChild(child){this.children.push(child);return child;}
    replaceChildren(...children){
      // Detach replaced subtrees so selectors only see the rendered document, as a browser does.
      const drop=node=>{const i=all.indexOf(node);if(i>=0)all.splice(i,1);(node.children||[]).forEach(drop);};this.children.forEach(drop);
      this.children=children;if(this.tagName==='select')this.value=children[0]?.value||'';}
    insertAdjacentHTML(_position,html){parseMarkup(html);}
    focus(){} select(){} setSelectionRange(){} removeAttribute(key){delete this[key];}
  }
  const doc={head:{innerHTML:''},visibilityState:'visible',getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);},
    querySelectorAll:selector=>{
      const data=/^\[data-([a-z-]+)\]$/.exec(selector),key=data&&data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
      return all.filter(e=>selector==='button,input,select,textarea'?['button','input','select','textarea'].includes(e.tagName):key?e.dataset[key]!==undefined:false);
    },listeners};
  function parseMarkup(html){
    const tags=/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g;let match;
    while((match=tags.exec(html))){
      const element=new Element(match[1]);element.id=match[3];ids.set(element.id,element);
      element.hidden=/\bhidden\b/.test(match[2]);element.disabled=/\bdisabled\b/.test(match[2]);element.value=/\bvalue="([^"]*)"/.exec(match[2])?.[1]||'';
      if(element.tagName==='select')element.value=/\bvalue="([^"]*)"/.exec(html.slice(tags.lastIndex,html.indexOf('</select>',tags.lastIndex)))?.[1]||'';
    }
  }
  doc.body={set innerHTML(html){ids.clear();all.length=0;parseMarkup(html);}};
  return {doc,all,Option:function(text,value){this.textContent=text;this.value=value;},get:id=>{assert(ids.has(id),`missing element ${id}`);return ids.get(id);}};
}
async function setup(mode='denied',extra={}) {
  const dom=documentMock(),store=new Map(),hooks=[],requests=[],revoked=[];let start,visible=false,unload,open,resolvePermission;
  store.set('risu-chronicle:v1:settings',JSON.stringify({enabled:true,...extra.settings}));
  store.set('risu-chronicle:v1:health',JSON.stringify({status:'ok',message:'이전 실행의 요약 완료 기록',at:'2026-11-18T10:00:00Z'}));
  const message=Array.from({length:10},(_,i)=>[{role:'user',data:`입력 ${i+1}`,chatId:`u${i+1}`},{role:'char',data:`응답 ${i+1}`,chatId:`a${i+1}`}]).flat();
  const char={type:'character',chaId:'qa-character',name:'합성 테스트',chatPage:0,chats:[{id:'qa-chat',name:'합성 대화',message}]};
  class FileURL extends URL{static createObjectURL(){return 'blob:synthetic-backup';}static revokeObjectURL(url){revoked.push(url);}}
  const api={pluginStorage:{getItem:async k=>store.get(k),setItem:async(k,v)=>store.set(k,v),keys:async()=>[...store.keys()],removeItem:async k=>store.delete(k)},
    safeLocalStorage:{getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}},getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getCharacter:async()=>structuredClone(char),
    registerSetting:async(_name,fn)=>{open=fn;},registerButton:async()=>{},onUnload:async fn=>{unload=fn;},showContainer:async()=>{visible=true;},hideContainer:async()=>{visible=false;},
    addRisuReplacer:async(_name,fn)=>{requests.push('add');if(mode==='pending')await new Promise(resolve=>resolvePermission=resolve);if(mode==='granted')hooks.push(fn);},
    requestPluginPermission:async()=>{requests.push('permission');return mode==='granted';},removeRisuReplacer:async(_name,fn)=>{const i=hooks.indexOf(fn);if(i>=0)hooks.splice(i,1);},
    ...(extra.api?extra.api(char,store):{})};
  if(extra.prepare)await extra.prepare(char,store);
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Chronicle_Memory.js'),'utf8'),{risuai:api,document:dom.doc,Option:dom.Option,URL:FileURL,Blob,TextEncoder,structuredClone,crypto:globalThis.crypto,
    setTimeout:fn=>{start=fn;return 1;},clearTimeout:()=>{start=null;},console});
  const settle=async()=>{await new Promise(r=>setImmediate(r));};
  return {...dom,char,store,hooks,requests,revoked,settle,open:()=>open(),start:()=>start?.(),unload:()=>unload(),visible:()=>visible,
    setMode:value=>{mode=value;},resolve:()=>resolvePermission(),click:async id=>{await dom.get(id).onclick();await settle();}};
}
test('the real bundle keeps denied hook state separate from a previous successful summary',async()=>{
  const h=await setup();await h.open();assert(!h.get('chatTitle').textContent.includes('사용할 수 없습니다'));
  await h.click('ensureHook');assert.match(h.get('hookStatus').textContent,/미승인/);assert.equal(h.get('hookStatus').dataset.warning,'true');
  assert.match(h.get('health').textContent,/이전 실행의 요약 완료/);assert.equal(h.get('close').disabled,false);assert.equal(h.hooks.length,0);
});
test('pending host consent leaves settings save, close, and reopen usable without duplicate registration',async()=>{
  const h=await setup('pending');await h.open();await h.click('ensureHook');
  assert.match(h.get('hookStatus').textContent,/응답 대기/);assert.equal(h.get('ensureHook').disabled,true);
  await h.click('saveSettings');assert.match(h.get('status').textContent,/설정 저장 완료/);assert.equal(h.requests.filter(v=>v==='add').length,1);
  await h.click('close');assert.equal(h.visible(),false);await h.open();assert.match(h.get('hookStatus').textContent,/응답 대기/);
  h.setMode('granted');h.resolve();await h.settle();assert.match(h.get('hookStatus').textContent,/승인·등록 확인/);
  await h.hooks[0]([],'memory');assert.match(h.get('hookStatus').textContent,/실행은 아직/);
  h.store.set('risu-chronicle:v1:settings',JSON.stringify({enabled:false}));
  await h.hooks[0]([],'model');assert.match(h.get('hookStatus').textContent,/마지막 RP 훅/);
});
test('bundle unload revokes a prepared backup URL, removes listeners, and unregisters its hook',async()=>{
  const h=await setup('granted');await h.open();await h.click('ensureHook');await h.click('export');
  assert.equal(h.get('backupReady').hidden,false);assert.equal(h.get('backupDownload').href,'blob:synthetic-backup');
  assert.equal(h.doc.listeners.size,2);assert.equal(h.hooks.length,1);await h.unload();
  assert(h.revoked.includes('blob:synthetic-backup'));assert.equal(h.doc.listeners.size,0);assert.equal(h.hooks.length,0);
});
test('fixed and versioned update bundles are byte-identical with matching update metadata',()=>{
  const root=path.join(__dirname,'..'),version=require('../package.json').version;
  const fixed=fs.readFileSync(path.join(root,'Chronicle_Memory.js'));
  assert.deepEqual(fixed,fs.readFileSync(path.join(root,`Chronicle_Memory_v${version}.js`)));
  assert(fixed.toString().includes(`//@version ${version}\n`));
  assert.match(fixed.toString(),/\/\/@update-url https:\/\/raw\.githubusercontent\.com\/HyunnJg\/RisuAI_Chronicle_Memory\/main\/Chronicle_Memory\.js\n/);
});
const C=require('../core.cjs');
const STATE_KEY='risu-chronicle:v1:chat:qa-character:qa-chat';
async function twoChunks(char,store){
  const tl=await C.timeline(char.chats[0].message);
  let state=C.commit(C.emptyState(),tl.turns.slice(0,5),{title:'첫 구간',keywords:['출발'],text:'기존 기록 A\n두 사람이 내일 서점에서 보기로 함.',warnings:[]});
  state=C.commit(state,tl.turns.slice(5,10),{title:'둘째 구간',keywords:['서점'],text:'기존 기록 B',warnings:[]});
  store.set(STATE_KEY,JSON.stringify(state));
}
const redoReply=(calls,options={})=>()=>({runLLMModel:async opts=>{
  calls.push(opts);if(options.onCall)return options.onCall(opts);
  const rows=JSON.parse(opts.messages[1].content),turns=Array.isArray(rows)?rows:rows.turns;
  return {type:'success',result:JSON.stringify({from:turns[0].turn,to:turns.at(-1).turn,title:'다시 쓴 구간',keywords:['재요약'],events:[{date:'',time:'',summary:'새로 요약한 기록.'}]})};
}});
const button=(h,id)=>h.all.find(e=>e.dataset.resummarizeId===id);
test('v0.8.0 re-summarizing one chunk replaces only it, archives the old version, and needs confirmation',async()=>{
  const calls=[];const h=await setup('denied',{prepare:twoChunks,api:redoReply(calls)});
  await h.open();const before=JSON.parse(h.store.get(STATE_KEY)),[first,second]=before.entries;
  assert.equal(button(h,second.id).disabled,false);
  button(h,second.id).onclick();assert.equal(h.get('resummarizeConfirmation').hidden,false);assert.equal(calls.length,0);
  assert.match(h.get('resummarizeTarget').textContent,/6–10턴 · 둘째 구간/);
  await h.click('cancelResummarize');assert.equal(h.get('resummarizeConfirmation').hidden,true);
  button(h,second.id).onclick();await h.click('confirmResummarize');
  assert.equal(calls.length,1);const sent=JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(sent.turns.map(t=>t.turn),[6,7,8,9,10]);
  assert.deepEqual(sent.previous,{from:1,to:5,title:'첫 구간',lastEvents:['기존 기록 A','두 사람이 내일 서점에서 보기로 함.']});
  const after=JSON.parse(h.store.get(STATE_KEY));
  assert.deepEqual(after.entries[0],first);assert.equal(after.entries.length,2);
  assert.notEqual(after.entries[1].id,second.id);assert.equal(after.entries[1].text,'새로 요약한 기록.');
  assert.equal(after.entries[1].hash,second.hash);assert.equal(after.revision,before.revision+1);
  assert.equal(after.archive.at(-1).reason,'사용자 재요약');assert.deepEqual(after.archive.at(-1).entries,[second]);
  assert.match(h.get('status').textContent,/T6~T10 다시 요약 완료/);
  // A confirmation is consumed once; confirming again does nothing.
  await h.click('confirmResummarize');assert.equal(calls.length,1);
});
test('v0.8.0 failed, stale, or edited-during-call re-summaries keep the stored chunk untouched',async()=>{
  const calls=[];let mode='fail';
  const h=await setup('denied',{prepare:twoChunks,api:redoReply(calls,{onCall:opts=>{
    if(mode==='fail')return {type:'fail',result:'server overloaded'};
    if(mode==='edit')h.char.chats[0].message[1].data='응답 1 (수정됨)';
    const rows=JSON.parse(opts.messages[1].content),turns=Array.isArray(rows)?rows:rows.turns;
    return {type:'success',result:JSON.stringify({from:turns[0].turn,to:turns.at(-1).turn,title:'늦은 결과',keywords:[],events:[{summary:'저장되면 안 됨'}]})};
  }})});
  await h.open();const before=h.store.get(STATE_KEY),id=JSON.parse(before).entries[0].id;
  button(h,id).onclick();await h.click('confirmResummarize');
  const entries=()=>JSON.parse(h.store.get(STATE_KEY)).entries;
  assert.equal(calls.length,1);assert.deepEqual(entries(),JSON.parse(before).entries);assert.equal(JSON.parse(h.store.get(STATE_KEY)).archive.length,0);assert.match(h.get('status').textContent,/실패 · 기존 청크를 그대로 유지/);
  // Source edited while the model call is running: the late response is discarded.
  mode='edit';button(h,id).onclick();await h.click('confirmResummarize');
  assert.equal(calls.length,2);assert(!h.store.get(STATE_KEY).includes('저장되면 안 됨'));
  const saved=JSON.parse(h.store.get(STATE_KEY));
  // The edit itself archives both chunks through the normal reconcile; the late result is never a replacement.
  assert.deepEqual(saved.entries,[]);assert(!saved.archive.some(row=>row.reason==='사용자 재요약'));
  assert.deepEqual(saved.archive.flatMap(row=>row.entries).map(e=>e.text),JSON.parse(before).entries.map(e=>e.text));
  // The edited source no longer matches chunk 1: after reload it is archived, never re-summarized.
  await h.click('reload');assert.equal(button(h,id),undefined);
});
test('v0.8.0 re-summary asks to save pending log edits first and blocks a stale confirmation',async()=>{
  const calls=[];const h=await setup('denied',{prepare:twoChunks,api:redoReply(calls)});
  await h.open();const [first]=JSON.parse(h.store.get(STATE_KEY)).entries;
  h.all.find(e=>e.dataset.entryId===first.id).value='저장 안 한 수정';button(h,first.id).onclick();
  assert.equal(h.get('resummarizeConfirmation').hidden,true);assert.match(h.get('status').textContent,/저장하지 않은 로그 수정/);
  await h.click('reload');button(h,first.id).onclick();
  // Memory changed after the confirmation opened (e.g. an RP request committed a chunk).
  const state=JSON.parse(h.store.get(STATE_KEY));state.revision+=5;h.store.set(STATE_KEY,JSON.stringify(state));
  await h.click('confirmResummarize');assert.equal(calls.length,0);assert.match(h.get('status').textContent,/기억이 변경되었습니다/);
});
test('v0.8.0 settings reject invalid removal patterns, preview removals, and warn on nested quantifiers',async()=>{
  const h=await setup('denied',{settings:{inputFilters:[{pattern:'\\[OOC[^\\]]*\\]',flags:'g',enabled:true}]}});await h.open();
  const rows=()=>h.all.filter(e=>e.dataset.filterPattern!==undefined);
  assert.equal(rows().length,1);assert.equal(rows()[0].value,'\\[OOC[^\\]]*\\]');assert.match(h.get('filterCount').textContent,/1\/20/);
  h.get('filterSample').value='그녀가 웃었다. [OOC: 다음 장면]';h.get('previewFilters').onclick();
  assert.equal(h.get('filterResult').value,'그녀가 웃었다. ');assert.match(h.get('filterState').textContent,/제거 전 21글자 → 제거 후 9글자/);
  h.get('addFilter').onclick();assert.equal(rows().length,2);rows()[1].value='(unclosed';
  const saved=h.store.get('risu-chronicle:v1:settings');
  await h.click('saveSettings');assert.match(h.get('status').textContent,/규칙 2: 패턴을 해석할 수 없어 저장하지 않았습니다|제거 정규식 2/);
  assert.equal(h.store.get('risu-chronicle:v1:settings'),saved);
  rows()[1].value='(a+)+';h.get('previewFilters').onclick();assert.match(h.get('filterState').textContent,/규칙 2번은 중첩 반복/);
  await h.click('saveSettings');assert.match(h.get('status').textContent,/설정 저장 완료 · 제거 규칙 2번은 중첩 반복/);
  assert.deepEqual(JSON.parse(h.store.get('risu-chronicle:v1:settings')).inputFilters.map(r=>r.pattern),['\\[OOC[^\\]]*\\]','(a+)+']);
  // Deleting a row and leaving an empty one stores only real patterns.
  h.all.filter(e=>e.textContent==='이 규칙 삭제')[1].onclick();h.get('addFilter').onclick();assert.equal(rows().length,2);
  await h.click('saveSettings');assert.deepEqual(JSON.parse(h.store.get('risu-chronicle:v1:settings')).inputFilters.map(r=>r.pattern),['\\[OOC[^\\]]*\\]']);
});
