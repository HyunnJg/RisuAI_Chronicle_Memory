// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
// Minimal DOM for interaction/structure checks, not a browser rendering or layout test.
function documentMock() {
  const ids=new Map(),all=[],listeners=new Map();
  class Element {
    constructor(tag='div'){this.tagName=tag;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.dataset={};this.textContent='';this.children=[];all.push(this);}
    appendChild(child){this.children.push(child);return child;}
    replaceChildren(...children){this.children=children;if(this.tagName==='select')this.value=children[0]?.value||'';}
    insertAdjacentHTML(_position,html){parseMarkup(html);}
    focus(){} select(){} setSelectionRange(){} removeAttribute(key){delete this[key];}
  }
  const doc={head:{innerHTML:''},visibilityState:'visible',getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag),
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);},
    querySelectorAll:selector=>all.filter(e=>selector==='button,input,select,textarea'?['button','input','select','textarea'].includes(e.tagName):false),listeners};
  function parseMarkup(html){
    const tags=/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g;let match;
    while((match=tags.exec(html))){
      const element=new Element(match[1]);element.id=match[3];ids.set(element.id,element);
      element.hidden=/\bhidden\b/.test(match[2]);element.disabled=/\bdisabled\b/.test(match[2]);element.value=/\bvalue="([^"]*)"/.exec(match[2])?.[1]||'';
      if(element.tagName==='select')element.value=/\bvalue="([^"]*)"/.exec(html.slice(tags.lastIndex,html.indexOf('</select>',tags.lastIndex)))?.[1]||'';
    }
  }
  doc.body={set innerHTML(html){ids.clear();all.length=0;parseMarkup(html);}};
  return {doc,Option:function(text,value){this.textContent=text;this.value=value;},get:id=>{assert(ids.has(id),`missing element ${id}`);return ids.get(id);}};
}
async function setup(mode='denied') {
  const dom=documentMock(),store=new Map(),hooks=[],requests=[],revoked=[];let start,visible=false,unload,open,resolvePermission;
  store.set('risu-chronicle:v1:settings',JSON.stringify({enabled:true}));
  store.set('risu-chronicle:v1:health',JSON.stringify({status:'ok',message:'이전 실행의 요약 완료 기록',at:'2026-11-18T10:00:00Z'}));
  const message=Array.from({length:10},(_,i)=>[{role:'user',data:`입력 ${i+1}`,chatId:`u${i+1}`},{role:'char',data:`응답 ${i+1}`,chatId:`a${i+1}`}]).flat();
  const char={type:'character',chaId:'qa-character',name:'합성 테스트',chatPage:0,chats:[{id:'qa-chat',name:'합성 대화',message}]};
  class FileURL extends URL{static createObjectURL(){return 'blob:synthetic-backup';}static revokeObjectURL(url){revoked.push(url);}}
  const api={pluginStorage:{getItem:async k=>store.get(k),setItem:async(k,v)=>store.set(k,v),keys:async()=>[...store.keys()],removeItem:async k=>store.delete(k)},
    safeLocalStorage:{getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}},getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getCharacter:async()=>structuredClone(char),
    registerSetting:async(_name,fn)=>{open=fn;},registerButton:async()=>{},onUnload:async fn=>{unload=fn;},showContainer:async()=>{visible=true;},hideContainer:async()=>{visible=false;},
    addRisuReplacer:async(_name,fn)=>{requests.push('add');if(mode==='pending')await new Promise(resolve=>resolvePermission=resolve);if(mode==='granted')hooks.push(fn);},
    requestPluginPermission:async()=>{requests.push('permission');return mode==='granted';},removeRisuReplacer:async(_name,fn)=>{const i=hooks.indexOf(fn);if(i>=0)hooks.splice(i,1);}};
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Chronicle_Memory.js'),'utf8'),{risuai:api,document:dom.doc,Option:dom.Option,URL:FileURL,Blob,TextEncoder,structuredClone,crypto:globalThis.crypto,
    setTimeout:fn=>{start=fn;return 1;},clearTimeout:()=>{start=null;},console});
  const settle=async()=>{await new Promise(r=>setImmediate(r));};
  return {...dom,store,hooks,requests,revoked,settle,open:()=>open(),start:()=>start?.(),unload:()=>unload(),visible:()=>visible,
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
