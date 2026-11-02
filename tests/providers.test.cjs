// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../providers.cjs'),C=require('../core.cjs');
const messages=[{role:'system',content:'기록자'},{role:'user',content:'기록 대상'}];
const config=provider=>C.settings({provider,model:provider==='anthropic'?'claude-test':'gemini-3.8-flash',...P.defaults(provider),...(provider==='external'?{endpoint:'https://example.org/v1',model:'openai/test-model'}:{model:provider==='anthropic'?'claude-test':'gemini-3.8-flash'})});
function transport(responses) {
  const calls=[];
  const api={nativeFetch:async(url,options)=>{calls.push({url,options});const item=responses.shift();if(!item)throw Error('Unexpected request');return new Response(JSON.stringify(item.body),{status:item.status||200});}};
  return {api,calls};
}
test('base URLs normalize to exact Chat Completions path without duplication',()=>{
  assert.equal(P.compatibleURL('https://generativelanguage.googleapis.com/v1beta/openai'),'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(P.compatibleURL('https://example.org/v1/'),'https://example.org/v1/chat/completions');
  assert.equal(P.compatibleURL('https://example.org/v1/chat/completions'),'https://example.org/v1/chat/completions');
  assert.equal(P.compatibleURL('http://localhost:5000'),'http://localhost:5000/v1/chat/completions');
  assert.throws(()=>P.compatibleURL('https://googleapis.com'),/Gemini AIS/);
  assert.throws(()=>P.compatibleURL('https://example.org/v1?key=bad'));
});
test('Gemini AIS sends native payload and header and excludes reasoning parts',async()=>{
  const h=transport([{body:{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'reasoning'},{text:'{"events":[]}'}]}}]}}]);
  const result=await P.complete(h.api,config('gemini'),'TEST-KEY',messages);
  assert.equal(result,'{"events":[]}');assert.match(h.calls[0].url,/gemini-3.8-flash:generateContent$/);
  assert.equal(h.calls[0].options.headers['x-goog-api-key'],'TEST-KEY');
  const body=JSON.parse(h.calls[0].options.body);assert.equal(body.generationConfig.maxOutputTokens,500);assert.equal(body.systemInstruction.parts[0].text,'기록자');
  assert.equal(body.generationConfig.thinkingConfig.includeThoughts,false);
});
test('Anthropic uses Messages format rather than Chat Completions',async()=>{
  const h=transport([{body:{content:[{type:'text',text:'result'}],stop_reason:'end_turn'}}]);
  assert.equal(await P.complete(h.api,config('anthropic'),'TEST-KEY',messages),'result');
  const {url,options}=h.calls[0],body=JSON.parse(options.body);
  assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],'TEST-KEY');assert.equal(body.system,'기록자');assert.equal(body.messages.length,1);assert.equal(body.max_tokens,500);
});
test('OpenAI sends max_completion_tokens and strips internal memo fields',async()=>{
  const h=transport([{body:{choices:[{message:{content:'okay'},finish_reason:'stop'}]}}]);
  await P.complete(h.api,{...config('openai'),model:'gpt-test'},'TEST-KEY',[{...messages[0],memo:'internal'},messages[1]]);
  const body=JSON.parse(h.calls[0].options.body);assert.equal(body.max_completion_tokens,500);assert(!('memo' in body.messages[0]));
});
test('custom OpenAI-compatible providers retain slash model IDs',async()=>{
  const h=transport([{body:{choices:[{message:{content:'okay'}}]}}]);
  await P.complete(h.api,config('external'),'TEST-KEY',messages);
  assert.equal(JSON.parse(h.calls[0].options.body).model,'openai/test-model');
});
test('HTTP error explains failure and redacts keys',async()=>{
  const h=transport([{status:401,body:{error:{message:'Invalid TEST-KEY Authorization: Bearer TEST-KEY'}}}]);
  await assert.rejects(()=>P.complete(h.api,config('gemini'),'TEST-KEY',messages),e=>e.message.includes('401')&&!e.message.includes('TEST-KEY'));
});
test('native failures preserve upstream detail and distinguish mode choices',async()=>{
  await assert.rejects(()=>P.complete({runLLMModel:async()=>({type:'fail',result:'403 missing permission'})},config('submodel'),'',messages),/403 missing permission/);
  for(const [provider,expected] of [['submodel','submodel'],['memory','memory'],['main','model']]){
    let seen;await P.complete({runLLMModel:async opt=>{seen=opt;return {type:'success',result:'okay'};}},{...config(provider),allowPlugins:true},'',messages);
    assert.equal(seen.mode,expected);assert.equal(seen.allowPlugins,true);
  }
});
test('native multiline and streaming shapes are normalized',async()=>{
  assert.equal(await P.nativeText({type:'multiline',result:[['char','text']]}),'text');
  await assert.rejects(()=>P.nativeText({type:'multiline',result:[['char','a'],['char','b']]}),/여러 응답/);
  const stream=new ReadableStream({start(controller){controller.enqueue({'0':'hel'});controller.enqueue({'0':'hello'});controller.close();}});
  assert.equal(await P.nativeText({type:'streaming',result:stream}),'hello');
});
test('native cumulative stream reads only answer channels and ignores thought fields and parts',async()=>{
  const stream=new ReadableStream({start(c){
    c.enqueue({thought:true,text:'별도 생각'});c.enqueue({type:'thinking',text:'다른 추론'});
    c.enqueue({'0':'{"from":1',reasoning_content:'섞이면 안 되는 추론',thoughts:'추론 표시'});
    c.enqueue({'0':'{"from":1,"to":5}',reasoning:'이것도 제외'});c.close();
  }});
  assert.equal(await P.nativeText({type:'streaming',result:stream}),'{"from":1,"to":5}');
});
test('Gemini models list paginates and filters out embeddings',async()=>{
  const h=transport([{body:{models:[{name:'models/gemini-a',supportedGenerationMethods:['generateContent']},{name:'models/embed',supportedGenerationMethods:['embedContent']}],nextPageToken:'NEXT'}},
    {body:{models:[{name:'models/gemini-b',supportedGenerationMethods:['generateContent']}]}}]);
  const list=await P.models(h.api,config('gemini'),'KEY');assert.deepEqual(list.map(m=>m.id),['gemini-a','gemini-b']);assert.match(h.calls[1].url,/pageToken=NEXT/);
});
test('Anthropic models list respects pagination cursor',async()=>{
  const h=transport([{body:{data:[{id:'claude-a',display_name:'A'}],has_more:true,last_id:'claude-a'}},{body:{data:[{id:'claude-b'}],has_more:false}}]);
  assert.equal((await P.models(h.api,config('anthropic'),'KEY')).length,2);assert.match(h.calls[1].url,/after_id=claude-a/);
});
test('Vertex service account signs JWT, obtains token, and reuses it for inference',async()=>{
  const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const sa={type:'service_account',client_email:'test@example.invalid',project_id:'project-test',private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://untrusted.example.invalid'};
  const h=transport([{body:{access_token:'TEST_ACCESS_TOKEN',expires_in:3600}},{body:{candidates:[{content:{parts:[{text:'first'}]}}]}},{body:{candidates:[{content:{parts:[{text:'second'}]}}]}}]);
  assert.equal(await P.complete(h.api,config('vertex'),JSON.stringify(sa),messages),'first');
  assert.equal(await P.complete(h.api,config('vertex'),JSON.stringify(sa),messages),'second');
  assert.equal(h.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,1);
  const jwt=new URLSearchParams(h.calls[0].options.body).get('assertion'),parts=jwt.split('.');
  assert(crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')));
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.exp-claims.iat,3600);
  assert.match(h.calls[1].url,/aiplatform.googleapis.com\/v1\/projects\/project-test\/locations\/global\/publishers\/google/);
  assert(!h.calls[1].options.body.includes('PRIVATE KEY'));
});
test('missing browser RSA support explains the Vertex environment failure before sending credentials',async()=>{
  const vm=require('node:vm');
  const provider=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../providers.cjs'),'utf8')+'\nChronicleProviders;',
    {crypto:{subtle:{digest(){}}},URL,TextEncoder,TextDecoder,console});
  let calls=0;
  await assert.rejects(()=>provider.complete({nativeFetch:async()=>{calls++;}},config('vertex'),'not-sent',messages),/Vertex 인증 서명.*HTTPS/);
  assert.equal(calls,0);
});
test('chat module overrides are local and inherit without changing global defaults',()=>{
  const defaults=C.settings({enabled:false});
  const effective=C.chatSettings(defaults,{scriptstate:{$chronicle_enabled:'1',$chronicle_interval:'10',$chronicle_chars:'150',$chronicle_mode:'append'}});
  assert.equal(effective.enabled,true);assert.equal(effective.interval,10);assert.equal(effective.charsPerTurn,150);assert.equal(effective.mode,'hybrid');assert.equal(defaults.interval,5);
  assert.equal(C.chatSettings(defaults,{scriptstate:{$chronicle_interval:'inherit'}}).interval,5);
  const invalid=C.chatSettings(defaults,{scriptstate:{$chronicle_interval:'99'}});
  assert.equal(invalid.interval,5);assert.equal(invalid.settingWarnings.length,1);
});
test('built risum contains native settings and captions with no display injection',()=>{
  const version=require('../package.json').version;
  const data=fs.readFileSync(path.join(__dirname,`../Chronicle_Control_v${version}.risum`)),map=fs.readFileSync(path.join(__dirname,'../rpack_map.bin'));
  assert.equal(data[0],111);assert.equal(data[1],0);const size=data.readUInt32LE(2);
  const decoded=Buffer.from(data.subarray(6,6+size).map(b=>map[256+b]));const obj=JSON.parse(decoded.toString());
  assert.equal(obj.type,'risuModule');assert.equal(obj.module.lowLevelAccess,false);assert.equal(obj.module.lorebook.length,0);
  assert.equal(obj.module.regex.length,0);assert.match(obj.module.customModuleToggle,/chronicle_ctl_interval=.*=text/);
  assert.match(obj.module.customModuleToggle,/캐시|캐시는/);assert.match(obj.module.customModuleToggle,/=caption/);
  assert.match(obj.module.customModuleToggle,/Risu 기억 병행/);assert.match(obj.module.customModuleToggle,/chronicle_ctl_risu_scope=.*=select/);assert.match(obj.module.customModuleToggle,/모듈설정 사용/);
  assert(!obj.module.customModuleToggle.includes('chronicle_ctl_timeout='));assert(!obj.module.customModuleToggle.includes('chronicle_ctl_budget='));assert.match(obj.module.customModuleToggle,/chronicle_ctl_clean=.*=select/);
  assert.equal(obj.module.trigger[0].type,'start');assert.match(obj.module.trigger[0].effect[0].code,/getGlobalVar/);
  assert.match(obj.module.trigger[0].effect[0].code,/setChatVar/);assert(!obj.module.trigger[0].effect[0].code.includes('nativeFetch'));
});
