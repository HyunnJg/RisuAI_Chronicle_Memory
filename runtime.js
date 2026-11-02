// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
/* Runtime adapter for RisuAI API 3.0. Bundled after core.cjs. */
(async () => {
  'use strict';
  const C=ChronicleCore, P=ChronicleProviders, R=ChronicleRetrieval, api=globalThis.risuai || globalThis.Risuai;
  if (!api) throw Error('RisuAI API 3.0이 필요합니다.');
  const NS='risu-chronicle:v1:', SETTINGS=NS+'settings', KEY=NS+'external-key', CHAT_PREFIX=NS+'chat:', BLOCK_PREFIX=NS+'cache-block:';
  let serial=Promise.resolve(), lastStatus='준비됨', uiContext=null, uiState=null, failedUntil=new Map(), embeddingFailedUntil=new Map(),recoveringConfig=false;
  const exclusive=fn=>{
    const task=serial.then(fn); serial=task.catch(()=>{}); return task;
  };
  async function read(key,fallback) {
    const value=await api.pluginStorage.getItem(key);
    if(value==null) return structuredClone(fallback);
    return typeof value==='string'?JSON.parse(value):value;
  }
  const save=(key,value)=>api.pluginStorage.setItem(key,JSON.stringify(value));
  const D=ChronicleStorage.create(api.pluginStorage,NS,{validVector:R.validVector,entryHash:entry=>C.digest(R.document(entry))});
  async function config(recover=false){
    try{return C.settings(await read(SETTINGS,C.DEFAULTS));}
    catch(e){if(!recover)throw e;return {...C.DEFAULTS,configWarning:'저장된 설정을 읽을 수 없어 화면에 기본값을 표시합니다. 현재 RP 요청은 기억 처리를 건너뜁니다. 값을 확인하고 전체 설정 저장을 눌러 복구하세요. '+P.safeError(e)};}
  }
  const credentialKey=provider=>NS+'credential:'+provider;
  async function credential(provider) {
    const value=await api.safeLocalStorage.getItem(credentialKey(provider));
    return value || (provider==='external' ? (await api.safeLocalStorage.getItem(KEY)) || '' : '');
  }
  const embeddingCredentialKey=provider=>NS+'embedding-credential:'+provider;
  async function embeddingCredential(s){
    if(!s.embeddingReuseCredential||s.embeddingProvider==='voyage')return (await api.safeLocalStorage.getItem(embeddingCredentialKey(s.embeddingProvider)))||'';
    const value=await credential(s.embeddingProvider);
    if(value&&s.embeddingProvider==='external'&&!P.canReuseExternalCredential(s))throw Error('직접 입력 요약 서버와 임베딩 서버의 origin이 달라 키를 재사용하지 않습니다. 인증정보 재사용을 해제하고 임베딩 전용 키를 입력하세요.');
    return value;
  }
  let draftProfiles={}, draftSecrets={}, visibleProvider='submodel',draftEmbeddingProfiles={},draftEmbeddingSecrets={},visibleEmbeddingProvider='gemini';
  const EMBEDDING_KEYS=['embeddingModel','embeddingEndpoint','embeddingProject','embeddingLocation','embeddingVertexMethod','embeddingReuseCredential'];
  const PROFILE_KEYS=['endpoint','model','project','location','publisher','tokenField','anthropicVersion'];
  async function context() {
    const characterIndex=await api.getCurrentCharacterIndex();
    const char=await api.getCharacter();
    if (!char || char.type==='group') throw Error('첫 버전은 1:1 캐릭터 대화만 지원합니다.');
    const chatIndex=char.chatPage, chat=char.chats?.[chatIndex];
    if (!char.chaId || !chat?.id || !Array.isArray(chat.message)) throw Error('캐릭터/대화의 고유 ID를 확인할 수 없습니다. 대화를 저장하고 다시 시도하세요.');
    if(characterIndex!==await api.getCurrentCharacterIndex() || chatIndex!==await api.getCurrentChatIndex()) throw Error('대화가 전환되었습니다. 다시 시도하세요.');
    const key=NS+'chat:'+encodeURIComponent(char.chaId)+':'+encodeURIComponent(chat.id);
    return {key,characterIndex,chatIndex,charId:char.chaId,chatId:chat.id,charName:char.name,chatName:chat.name,chat,tl:await C.timeline(chat.message)};
  }
  async function persistState(ctx,state) {
    await D.sync(ctx.key,state);
    const next=C.stripDerivedState(state);
    next.cacheMeta={charId:ctx.charId,chatId:ctx.chatId,charName:ctx.charName,chatName:ctx.chatName,updatedAt:new Date().toISOString()};
    await save(ctx.key,next);
    if(next.entries.length)await api.pluginStorage.removeItem(BLOCK_PREFIX+ctx.key);
    return next;
  }
  async function cacheRows(charId=null) {
    let keys;
    try{keys=await api.pluginStorage.keys();}catch{return [];}
    const prefix=charId?CHAT_PREFIX+encodeURIComponent(charId)+':':CHAT_PREFIX,rows=[];
    for(const key of keys.filter(k=>k.startsWith(prefix))) {
      try {
        const state=C.validateState(await read(key,null)),parts=key.slice(CHAT_PREFIX.length).split(':');
        const meta=state.cacheMeta || {charId:decodeURIComponent(parts[0]),chatId:decodeURIComponent(parts.slice(1).join(':'))};
        rows.push({key,state,meta,turns:C.covered(state),chars:C.chars(C.memoryText(state))});
      } catch {rows.push({key,state:null,meta:{chatName:'읽을 수 없는 저장 기록'},turns:0,chars:0});}
    }
    return rows.sort((a,b)=>(b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
  }
  async function stateFor(ctx) {
    const saved=await read(ctx.key,null);
    if(saved!==null) {
      const state=C.validateState(saved);let enriched=false;
      for(const e of state.entries) {
        const turn=ctx.tl.turns[e.to-1];
        if(turn?.hash!==e.hash)break;
        if(!e.contentHash){e.contentHash=turn.contentHash;enriched=true;}
      }
      return enriched || !state.cacheMeta || C.hasDerivedState(state) ? persistState(ctx,state) : state;
    }
    let cfg;try{cfg=await config();}catch{return C.emptyState();}
    if(!cfg.autoRestoreCache || await read(BLOCK_PREFIX+ctx.key,false))return C.emptyState();
    let best=null;
    for(const row of await cacheRows(ctx.charId)) {
      if(!row.state || row.key===ctx.key)continue;
      const candidate=C.compatiblePrefix(row.state,ctx.tl);
      if(C.covered(candidate)>(best?C.covered(best.state):0))best={state:candidate,row};
    }
    if(best) {
      best.state.restoredFrom={key:best.row.key,at:new Date().toISOString(),automatic:true};
      lastStatus=`저장된 기억에서 공통 원문 T1~T${C.covered(best.state)}을 자동 복원했습니다.`;
      await D.copy(best.row.key,ctx.key,best.state.entries);
      return persistState(ctx,best.state);
    }
    return C.emptyState();
  }
  async function unchanged(ctx) {
    let now;
    try{now=await context();}catch{const error=Error('처리 중 대화/원문이 바뀌어 결과를 폐기했습니다. 다시 시도하세요.');error.code='CHRONICLE_CONTEXT_CHANGED';throw error;}
    if(now.key!==ctx.key || now.tl.fingerprint!==ctx.tl.fingerprint){const error=Error('처리 중 대화/원문이 바뀌어 결과를 폐기했습니다. 다시 시도하세요.');error.code='CHRONICLE_CONTEXT_CHANGED';throw error;}
  }
  async function summarize(batch,s,ctx) {
    const messages=C.summaryPrompt(batch,s,ctx),started=Date.now();
    const text=await P.complete(api,s,await credential(s.provider),messages);
    const parsed=C.parseSummary(text,batch,s);
    return {text:parsed,stats:{from:batch[0].number,to:batch.at(-1).number,summaryChars:parsed.contentChars,summaryTargetChars:parsed.targetChars,
      originalChars:C.chars(JSON.stringify(C.summaryInput(batch,{...s,cleanSummaryInput:false},ctx))),
      sentChars:C.chars(messages[1].content),seconds:Math.round((Date.now()-started)/100)/10,cleaned:s.cleanSummaryInput}};
  }
  async function generate(ctx,state,s,force=false) {
    let current=C.reconcile(state,ctx.tl);
    if(current.revision!==state.revision) await persistState(ctx,current);
    for(let n=0;n<s.batchesPerRequest;n++) {
      const batch=C.nextBatch(current,ctx.tl,s);
      if(!batch.length) break;
      const failureKey=ctx.key+':'+batch.at(-1).hash;
      if(!force && (failedUntil.get(failureKey)||0)>Date.now()) break;
      try {
        const result=await summarize(batch,s,ctx);
        await unchanged(ctx);
        current=C.commit(current,batch,result.text);current.lastSummaryInput=result.stats;
        await persistState(ctx,current); failedUntil.delete(failureKey);
        lastStatus=`T${batch[0].number}~T${batch.at(-1).number} 기록 완료`;
      } catch(e) {
        failedUntil.set(failureKey,Date.now()+60000);
        current.lastError=e.message; await persistState(ctx,current);
        lastStatus=e.message;
        break; // The failed chunk and every later chunk stay verbatim.
      }
    }
    return current;
  }
  async function recall(ctx,state,s,force=false){
    const warnings=[],query=R.query(ctx.tl),savedIndex=await D.vectors(ctx.key);
    const index={schema:1,entries:Object.assign(Object.create(null),savedIndex.entries)};
    const signature=await C.digest([s.embeddingProvider,s.embeddingModel,s.embeddingEndpoint,s.embeddingProject,s.embeddingLocation,s.embeddingVertexMethod,P.isVoyageEmbedding(s)?'chronicle-voyage-embedding-v1':'chronicle-embedding-v1']);
    let dirty=false,vector=null,embeddingReady=false,keywordReason='';
    const failureKey=ctx.key+':'+signature,active=new Set(state.entries.map(e=>e.id));
    for(const id of Object.keys(index.entries))if(!active.has(id)){delete index.entries[id];dirty=true;}
    if(s.embeddingModel.trim()&&(force||(embeddingFailedUntil.get(failureKey)||0)<=Date.now())){
      try{
        const secret=await embeddingCredential(s),pending=[];
        for(const entry of state.entries){
          const hash=await C.digest(R.document(entry)),cached=index.entries[entry.id];
          if(cached?.signature!==signature||cached?.hash!==hash||!R.validVector(cached?.vector)){
            if(cached){delete index.entries[entry.id];dirty=true;}
            pending.push({entry,hash});
          }
        }
        const batch=pending.slice(0,s.embeddingBatchesPerRequest);
        if(batch.length){
          const vectors=await P.embed(api,s,secret,batch.map(row=>R.document(row.entry)));
          await unchanged(ctx);
          for(let i=0;i<batch.length;i++)index.entries[batch[i].entry.id]={signature,hash:batch[i].hash,vector:vectors[i]};
          dirty=true;
        }
        const candidates=state.entries.filter(e=>e.from<=ctx.tl.turns.length-s.recent&&index.entries[e.id]?.signature===signature);
        if(candidates.length&&query){
          const hash=await C.digest(query),cached=D.query(ctx.key);
          if(cached?.signature===signature&&cached.hash===hash&&R.validVector(cached.vector))vector=cached.vector;
          else{[vector]=await P.embed(api,s,secret,[query],'query');await unchanged(ctx);D.saveQuery(ctx.key,{signature,hash,vector});}
          if(candidates.some(e=>index.entries[e.id].vector.length!==vector.length)){
            index.entries=Object.create(null);D.clearQuery(ctx.key);dirty=true;vector=null;
            throw Error('임베딩 차원이 바뀌었습니다. 다음 요청에서 색인을 다시 만듭니다.');
          }
          embeddingReady=true;
        }
        if(pending.length>batch.length)warnings.push(`임베딩 색인 ${pending.length-batch.length}개가 남았습니다. 다음 요청에서 이어서 처리합니다.`);
        embeddingFailedUntil.delete(failureKey);
      }catch(e){
        if(e.code==='CHRONICLE_CONTEXT_CHANGED')throw e;
        embeddingFailedUntil.set(failureKey,Date.now()+60000);
        keywordReason='embedding-error';
        warnings.push('임베딩 검색 실패: '+P.safeError(e)+'. 이번에는 키워드 검색으로 계속합니다.');
      }
    }else if(!s.embeddingModel.trim()){
      keywordReason='not-configured';warnings.push('임베딩 모델을 설정하지 않아 키워드 검색만 사용합니다. 플러그인 → 하이브리드 검색 연결에서 모델을 지정하세요.');
    }else{
      keywordReason='retry-wait';warnings.push('임베딩 오류 후 60초 재시도 대기 중입니다. 이번에는 키워드 검색으로 계속합니다.');
    }
    const candidates=[];
    for(const entry of state.entries){
      let cached=index.entries[entry.id];
      if(cached&&cached.hash!==await C.digest(R.document(entry))){delete index.entries[entry.id];cached=null;dirty=true;}
      if(entry.from<=ctx.tl.turns.length-s.recent)candidates.push({...entry,embedding:cached});
    }
    const ranked=R.rank(candidates,query,vector,signature,s.recallMinSimilarity),selected=R.select(ranked,s,C.entryText,C.chars);
    if(ranked.length&&!selected.selected.length)warnings.push('검색 결과가 재강조 글자 수보다 커서 추가하지 않았습니다. 범위를 늘리면 청크 전체를 넣습니다.');
    const method=!candidates.length||!query?'skipped':embeddingReady?'semantic+keyword':'keyword';
    const reason=!state.entries.length?'no-chunks':!candidates.length?'recent-raw':!query?'empty-query':method==='keyword'?(keywordReason||'indexing'):'';
    const info={at:new Date().toISOString(),method,reason,indexed:state.entries.filter(e=>index.entries[e.id]?.signature===signature).length,total:state.entries.length,
      selected:selected.selected.map(row=>({id:row.entry.id,from:row.entry.from,to:row.entry.to,semantic:row.semantic,keywords:row.keywords})),text:selected.text};
    await unchanged(ctx);
    try{if(dirty)await D.saveVectors(ctx.key,index);await D.saveRecall(ctx.key,info);}catch(e){warnings.push('검색 캐시 저장 실패: '+P.safeError(e)+'. 요약 기록은 유지합니다.');}
    return {text:selected.text,warnings,info};
  }
  async function beforeRequest(messages,type) {
    if(type!=='model'||messages.some(m=>m.memo==='risu-chronicle-summary-v1'))return messages;
    return exclusive(async()=>{
      try{
        const global=await config(),ctx=await context(),s=C.chatSettings(global,ctx.chat);
        if(!s.enabled)return messages;
        const initial=await stateFor(ctx),state=await generate(ctx,initial,s);
        await unchanged(ctx);
        const result=s.mode==='hybrid'&&state.entries.length?await recall(ctx,state,s):{text:'',warnings:[]};
        await unchanged(ctx);
        const warnings=[...s.settingWarnings,...(state.summaryWarnings||[]),...result.warnings];
        const out=C.inject(messages,state,ctx.tl,s,text=>warnings.push(text),result.text),warning=warnings.join('\n');
        if((state.lastWarning||'')!==warning){state.lastWarning=warning;await persistState(ctx,state);}
        if(warning)lastStatus=warning;
        return out;
      }catch(e){
        if(e.code==='CHRONICLE_CONTEXT_CHANGED')throw e;
        lastStatus='기억 처리를 건너뛰고 원래 RP 요청을 유지했습니다: '+P.safeError(e);
        return messages;
      }
    });
  }
  const $=id=>document.getElementById(id);
  function notify(text) {lastStatus=text; if($('status')) $('status').textContent=text;}
  function download(name,value) {
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function values() {
    return C.settings({enabled:$('enabled').checked,interval:Number($('interval').value),recent:Number($('recent').value),
      charsPerTurn:Number($('charsPerTurn').value),maxOutputTokens:Number($('maxOutputTokens').value),
      risuCharsPerTurn:Number($('risuCharsPerTurn').value),risuLogScope:$('risuLogScope').value,risuRecentChunks:Number($('risuRecentChunks').value),
      provider:$('provider').value,mode:$('mode').value,endpoint:$('endpoint').value.trim(),model:$('model').value.trim(),
      tokenField:$('tokenField').value,
      batchesPerRequest:Number($('batchesPerRequest').value),customPrompt:$('customPrompt').value,
      project:$('project').value.trim(),location:$('location').value.trim(),publisher:$('publisher').value,
      anthropicVersion:$('anthropicVersion').value.trim(),allowPlugins:$('allowPlugins').checked,profiles:draftProfiles,autoRestoreCache:$('autoRestoreCache').checked,
      cleanSummaryInput:$('cleanSummaryInput').checked,
      ...Object.fromEntries(EMBEDDING_KEYS.map(k=>[k,k==='embeddingReuseCredential'?($('embeddingProvider').value!=='voyage'&&$(k).checked):$(k).value.trim()])),
      embeddingProvider:$('embeddingProvider').value,embeddingProfiles:draftEmbeddingProfiles,
      recallTopK:Number($('recallTopK').value),recallCharBudget:Number($('recallCharBudget').value),recallMinSimilarity:Number($('recallMinSimilarity').value),embeddingBatchesPerRequest:Number($('embeddingBatchesPerRequest').value)});
  }
  function modeControls(){
    const paired=$('mode').value==='risu';
    $('localRawSettings').hidden=paired;$('localSummaryTarget').hidden=paired;$('risuSettings').hidden=!paired;
    $('risuChunkCount').hidden=$('risuLogScope').value!=='recent';
  }
  function captureEmbedding(){
    draftEmbeddingProfiles[visibleEmbeddingProvider]=Object.fromEntries(EMBEDDING_KEYS.map(k=>[k,k==='embeddingReuseCredential'?$(k).checked:$(k).value.trim()]));
    draftEmbeddingSecrets[visibleEmbeddingProvider]=$('embeddingSecret').value;
  }
  async function showEmbedding(provider){
    visibleEmbeddingProvider=provider;
    const profile={embeddingModel:provider==='voyage'?'voyage-4-large':'',embeddingEndpoint:'',embeddingProject:'',embeddingLocation:'us-central1',embeddingVertexMethod:'predict',embeddingReuseCredential:provider!=='voyage',...draftEmbeddingProfiles[provider]};
    for(const key of EMBEDDING_KEYS)if(key==='embeddingReuseCredential')$(key).checked=profile[key];else $(key).value=profile[key];
    if(!(provider in draftEmbeddingSecrets))draftEmbeddingSecrets[provider]=(await api.safeLocalStorage.getItem(embeddingCredentialKey(provider)))||'';
    $('embeddingSecret').value=draftEmbeddingSecrets[provider];$('embeddingSecret').type='password';$('embeddingShowSecret').checked=false;$('embeddingClearSecret').checked=false;
    $('embeddingEndpointPanel').hidden=provider!=='external';$('embeddingVertexPanel').hidden=provider!=='vertex';
    $('embeddingReusePanel').hidden=provider==='voyage';if(provider==='voyage')$('embeddingReuseCredential').checked=false;
    $('embeddingAddressHelp').textContent=provider==='voyage'?'Voyage API 주소는 자동 설정됩니다. voyage-4-large를 바로 사용하거나 기본 모델 목록에서 고를 수 있습니다.':'';
    $('embeddingModelSelect').replaceChildren(new Option('모델 목록을 불러오거나 ID를 직접 입력하세요',''));
    $('embeddingSecretHelp').textContent=provider==='vertex'?'별도 인증정보 입력 시 서비스 계정 JSON 전체를 붙여넣으세요.':'별도 인증정보 입력 시 임베딩 API 키를 넣으세요.';
    embeddingReuseChanged();
  }
  function embeddingReuseChanged(){
    $('embeddingSeparateSecret').hidden=$('embeddingReuseCredential').checked;
    const separate=!$('embeddingReuseCredential').checked;
    const external={provider:$('provider').value,endpoint:$('endpoint').value,embeddingEndpoint:$('embeddingEndpoint').value,profiles:draftProfiles};
    const blocked=!separate&&$('embeddingProvider').value==='external'&&!P.canReuseExternalCredential(external);
    $('embeddingCredentialState').textContent=blocked?'직접 입력 서버의 origin이 다르거나 확인되지 않았습니다. 키 재사용을 차단합니다. 재사용 체크를 해제하고 임베딩 전용 키를 입력하세요.':separate?'임베딩 전용 인증정보를 사용합니다. 제공자를 바꿔도 각각 보관합니다.':'같은 제공자에 저장한 요약 연결 인증정보를 사용합니다. 직접 입력 서버는 같은 origin일 때만 재사용합니다.';
  }
  function captureConnection() {
    draftProfiles[visibleProvider]=Object.fromEntries(PROFILE_KEYS.map(k=>[k,$(k).value.trim()]));
    if(!P.NATIVE.includes(visibleProvider)) draftSecrets[visibleProvider]=visibleProvider==='vertex'?$('serviceAccount').value:$('apiKey').value;
  }
  async function showConnection(provider) {
    visibleProvider=provider;const p={...P.defaults(provider),...draftProfiles[provider]};
    for(const key of PROFILE_KEYS) $(key).value=p[key];
    if(!(provider in draftSecrets))draftSecrets[provider]=await credential(provider);
    $('apiKey').value=draftSecrets[provider] || '';$('apiKey').type='password';$('showKey').checked=false;
    $('clearKey').checked=false;
    $('nativeOptions').hidden=!P.NATIVE.includes(provider);
    $('externalOptions').hidden=P.NATIVE.includes(provider);
    $('keyPanel').hidden=provider==='vertex';$('vertexPanel').hidden=provider!=='vertex';
    $('endpointPanel').hidden=provider!=='external';$('tokenPanel').hidden=provider!=='external';
    $('versionPanel').hidden=!['anthropic','vertex'].includes(provider);
    $('serviceAccount').value=provider==='vertex'?(draftSecrets.vertex || ''):'';
    $('modelSelect').replaceChildren(new Option('모델 목록 불러오기를 누르세요',''));
    $('keyState').textContent=draftSecrets[provider]?'저장된 인증정보를 불러왔습니다.':'인증정보를 입력하고 저장하세요.';
    $('autoAddress').textContent=provider==='vertex'?'Vertex 프로젝트·리전·모델에 맞춰 주소를 자동 구성합니다.':P.defaults(provider).endpoint || '주소를 직접 입력하세요.';
  }
  async function saveSettings() {
    captureConnection();
    captureEmbedding();
    if(visibleProvider==='vertex')draftSecrets.vertex=$('serviceAccount').value;
    if($('clearKey').checked)draftSecrets[visibleProvider]='';
    if(draftSecrets.vertex)P.serviceAccount(draftSecrets.vertex);
    const s=values();s.profiles=structuredClone(draftProfiles);
    if($('embeddingClearSecret').checked)draftEmbeddingSecrets[visibleEmbeddingProvider]='';
    if(!s.embeddingReuseCredential && s.embeddingProvider==='vertex' && draftEmbeddingSecrets.vertex)P.serviceAccount(draftEmbeddingSecrets.vertex);
    for(const [provider,key] of Object.entries(draftSecrets)) {
      if(key)await api.safeLocalStorage.setItem(credentialKey(provider),key);
      else await api.safeLocalStorage.removeItem(credentialKey(provider));
    }
    if(visibleProvider==='external'&&$('clearKey').checked)await api.safeLocalStorage.removeItem(KEY);
    for(const [provider,key] of Object.entries(draftEmbeddingSecrets)){
      if(key)await api.safeLocalStorage.setItem(embeddingCredentialKey(provider),key);else await api.safeLocalStorage.removeItem(embeddingCredentialKey(provider));
    }
    await save(SETTINGS,s);failedUntil.clear();embeddingFailedUntil.clear();
    if(recoveringConfig){recoveringConfig=false;$('diagnostics').textContent='설정을 복구했습니다. 현재 대화 불러오기로 적용값을 확인할 수 있습니다.';}
    $('apiKey').value=draftSecrets[visibleProvider] || '';
    $('serviceAccount').value=visibleProvider==='vertex'?(draftSecrets.vertex || ''):'';
    $('clearKey').checked=false;
    $('keyState').textContent=draftSecrets[visibleProvider]?'인증정보 저장됨 · 이 기기에 유지':'인증정보 없음';
    $('embeddingSecret').value=draftEmbeddingSecrets[visibleEmbeddingProvider]||'';$('embeddingClearSecret').checked=false;
    notify('설정 저장 완료');
  }
  function action(id,fn) {
    $(id).onclick=async()=>{
      const controls=[...document.querySelectorAll('button,input,select,textarea')],previous=controls.map(b=>b.disabled);
      controls.forEach(b=>b.disabled=true);
      try{await exclusive(fn);}catch(e){notify(e.message);}
      finally{controls.forEach((b,i)=>b.disabled=previous[i]);}
    };
  }
  async function loadEditor() {
    uiContext=await context();
    const old=await stateFor(uiContext); uiState=C.reconcile(old,uiContext.tl);
    if(old.revision!==uiState.revision) await persistState(uiContext,uiState);
    const state=uiState,ctx=uiContext;
    const cfg=C.chatSettings(await config(true),ctx.chat),unprocessed=ctx.tl.turns.length-C.covered(state);
    $('chatTitle').textContent=`${ctx.charName} / ${ctx.chatName || '대화'} · 완료 ${ctx.tl.turns.length}턴 · 요약 ${C.covered(state)}턴 · 미처리 ${unprocessed}턴 · 주기 ${cfg.interval}턴 · 보관 ${state.archive.length}묶음`;
    $('entries').replaceChildren();
    for(const e of state.entries) {
      const group=document.createElement('div');group.className='chunkEditor';
      const heading=document.createElement('strong');heading.textContent=`${e.from}–${e.to}턴${e.editedAt?' · 수동 수정됨':''}`;group.appendChild(heading);
      const titleLabel=document.createElement('label');titleLabel.textContent='청크 제목';
      const title=document.createElement('input');title.dataset.titleId=e.id;title.value=e.title||'';titleLabel.appendChild(title);group.appendChild(titleLabel);
      const keywordLabel=document.createElement('label');keywordLabel.textContent='검색 키워드 · 쉼표로 구분';
      const keywords=document.createElement('input');keywords.dataset.keywordsId=e.id;keywords.value=(e.keywords||[]).join(', ');keywordLabel.appendChild(keywords);group.appendChild(keywordLabel);
      const label=document.createElement('label');label.textContent='기록 본문 · 시점 표현은 있을 때만 표시';
      const area=document.createElement('textarea');area.dataset.entryId=e.id;area.value=e.text;area.rows=5;
      label.appendChild(area);group.appendChild(label);$('entries').appendChild(group);
    }
    if(!state.entries.length) $('entries').textContent='아직 생성한 사건 로그가 없습니다. 설정한 턴 수가 채워지면 다음 RP 요청 직전에 생성합니다.';
    $('preview').value=C.memoryText(state,cfg);
    const stats=state.lastSummaryInput;
    $('counts').textContent=`저장 원문: 사용자 ${ctx.tl.active.filter(m=>m.role==='user').length}개 · AI ${ctx.tl.active.filter(m=>m.role!=='user').length}개 (첫 인사 포함). 저장 로그 ${state.entries.length}청크 · 주입 ${C.injectedEntries(state,cfg).length}청크 / ${C.chars(C.memoryText(state,cfg))}글자. 토큰 수는 모델별로 다릅니다.`+
      (stats?` 최근 요약 T${stats.from}~T${stats.to}: 입력 JSON ${stats.originalChars} → ${stats.sentChars}글자 · ${stats.seconds}초.`+
        (Number.isFinite(stats.summaryChars)?` 저장 본문 ${stats.summaryChars}글자 / 권장 목표 ${stats.summaryTargetChars}글자.`:''):'');
    if($('effectiveSettings')) {
      const operation=cfg.mode==='risu'?`Risu 기억 병행 · 원문: Risu 관리 (최근 원문 수 미적용) · 자체 자동 검색 꺼짐 · 연대기 ${cfg.risuLogScope==='all'?'전체':cfg.risuLogScope==='recent'?`최근 ${cfg.risuRecentChunks}청크`:'기록만'}`:`${cfg.mode==='hybrid'?'자체 하이브리드':'단독'} · 최근 원문 ${cfg.recent}턴 + 미요약 구간 유지`;
      $('effectiveSettings').textContent=`현재 대화 적용값: ${cfg.enabled?'사용':'중지'} · ${cfg.interval}턴마다 · ${operation}`+
        ` · 청크 본문 권장 목표 ${C.summaryTarget(cfg,cfg.interval)}글자 (초과해도 수용) · 응답 ${cfg.maxOutputTokens}토큰 상한/목표 · 입력 정리 ${cfg.cleanSummaryInput?'사용':'해제'}`;
      $('diagnostics').textContent=[...new Set([cfg.configWarning||'',...cfg.settingWarnings,...(state.summaryWarnings||[]),state.lastWarning||''])].filter(Boolean).join('\n') || '설정·원문 확인 경고 없음';
    }
    const recallInfo=await D.recall(ctx.key);
    $('recallPreview').value=recallInfo?.text||'';
    let searchLabel='키워드 검색';
    if(recallInfo?.method==='skipped')searchLabel='검색 생략: '+({
      'recent-raw':'모든 청크가 최근 원문에 포함됨','empty-query':'검색할 최근 입력·상황이 없음','no-chunks':'저장된 청크가 없음'
    }[recallInfo.reason]||'검색 대상이 없음');
    else if(recallInfo?.method==='semantic+keyword')searchLabel='임베딩 의미 유사도 + 키워드 검색';
    else if(recallInfo?.reason)searchLabel=({
      'embedding-error':'키워드 대체 검색: 임베딩 오류','retry-wait':'키워드 대체 검색: 임베딩 재시도 대기',
      'not-configured':'키워드 검색: 임베딩 모델 미설정','indexing':'키워드 검색: 대상 청크 임베딩 색인 대기'
    }[recallInfo.reason]||searchLabel);
    $('recallState').textContent=(cfg.mode==='risu'?'Risu 기억 병행: 자체 자동 검색은 실행하지 않습니다. ':'')+(recallInfo?`임베딩 색인 ${recallInfo.indexed}/${recallInfo.total}개${recallInfo.total>0&&recallInfo.indexed===recallInfo.total?' 완료':''} · 마지막 실행: ${searchLabel} · 재강조 ${recallInfo.selected.length}개. 자체 하이브리드에서만 이 재강조 기록을 보냅니다.`:'아직 자체 하이브리드 검색을 실행하지 않았습니다.');
    notify((await config(true)).configWarning||state.lastError||lastStatus);
  }
  async function refreshEditor(){
    try{await loadEditor();}catch(e){
      uiContext=null;uiState=null;
      $('chatTitle').textContent='현재 대화의 기억 편집을 사용할 수 없습니다: '+P.safeError(e);
      $('entries').textContent='1:1 대화를 열면 현재 기억을 편집할 수 있습니다. 전역 설정과 저장된 기억 관리는 계속 사용할 수 있습니다.';
      for(const id of ['preview','recallPreview'])$(id).value='';
      $('counts').textContent='';$('recallState').textContent='';$('effectiveSettings').textContent='현재 대화에는 기억 처리를 적용하지 않습니다.';
      $('diagnostics').textContent=(await config(true)).configWarning||P.safeError(e);notify($('diagnostics').textContent);
    }
  }
  async function editorUnchanged() {
    if(!uiContext || !uiState) throw Error('먼저 현재 대화 불러오기를 누르세요.');
    await unchanged(uiContext);
    const latest=await stateFor(uiContext);
    if(latest.revision!==uiState.revision) throw Error('기억이 변경되었습니다. 현재 대화를 다시 불러오세요.');
    return latest;
  }
  let visibleCaches=[];
  async function loadCaches() {
    visibleCaches=await cacheRows();
    $('cacheSelect').replaceChildren(new Option('저장된 채팅을 선택하세요',''),...visibleCaches.map(row=>new Option(
      `${row.meta.charName || '캐릭터'} / ${row.meta.chatName || row.meta.chatId || '대화'} · ${row.turns}턴 · ${row.chars}글자`,row.key)));
    $('cacheCount').textContent=`${visibleCaches.length}개 채팅 기록 · ${visibleCaches.reduce((n,r)=>n+r.chars,0).toLocaleString()}글자 (보관함 분량 제외)`;
    $('cachePreview').value='';
  }
  function selectedCache() {
    const row=visibleCaches.find(r=>r.key===$('cacheSelect').value);
    if(!row)throw Error('먼저 저장된 채팅을 선택하세요.');return row;
  }
  async function removeCached(keys) {
    for(const key of keys) {
      if(!key.startsWith(CHAT_PREFIX))throw Error('기억 저장소 이외의 항목은 삭제할 수 없습니다.');
      await api.pluginStorage.removeItem(key);await D.reset(key);
      await save(BLOCK_PREFIX+key,true); // Prevent another branch immediately restoring deleted data.
    }
    failedUntil.clear();embeddingFailedUntil.clear();await refreshEditor();await loadCaches();
    notify(`${keys.length}개 채팅의 저장된 기억·보관함을 삭제했습니다. 원문 대화와 API 키는 유지합니다. 계속 사용하면 이후 요약은 새로 저장됩니다.`);
  }
  async function open() {
    const s=await config(true);
    recoveringConfig=!!s.configWarning;
    draftProfiles=structuredClone(s.profiles || {});
    draftProfiles[s.provider]={...P.defaults(s.provider),...draftProfiles[s.provider],...Object.fromEntries(PROFILE_KEYS.map(k=>[k,s[k]]))};
    draftSecrets={};
    draftEmbeddingProfiles=structuredClone(s.embeddingProfiles||{});
    draftEmbeddingProfiles[s.embeddingProvider]={...draftEmbeddingProfiles[s.embeddingProvider],...Object.fromEntries(EMBEDDING_KEYS.map(k=>[k,s[k]]))};
    draftEmbeddingSecrets={};
    document.head.innerHTML='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+`
      *{box-sizing:border-box}body{margin:0;background:#111822;color:#e6edf6;font:15px/1.55 system-ui,sans-serif}
      main{max-width:1000px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;gap:12px}header>button{flex:none;white-space:nowrap}
      h1{font-size:24px;margin:0}h2{font-size:18px;margin:0 0 12px}p{color:#b5c6d9}section{background:#192433;border:1px solid #304359;border-radius:12px;padding:20px;margin:16px 0}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}label{display:block;color:#c5d7eb;margin:8px 0}
      input,select,textarea{width:100%;background:#0e1723;color:#edf5ff;border:1px solid #456079;border-radius:6px;padding:9px;font:inherit}
      input[type=checkbox]{width:auto}textarea{display:block;resize:vertical;margin-top:6px}button{background:#a8dfcb;color:#10221c;border:0;border-radius:6px;padding:10px 15px;font-weight:700;cursor:pointer}
      button.secondary{background:#34475d;color:#edf5ff}button:disabled{opacity:.5;cursor:wait}.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
      [hidden]{display:none!important}#status{white-space:pre-wrap;padding:12px;background:#24384a;border-radius:6px;overflow-wrap:anywhere}small{color:#b5c6d9}summary{cursor:pointer}.chunkEditor{border-top:1px solid #456079;padding:14px 0}#effectiveSettings{display:block;white-space:pre-wrap;overflow-wrap:anywhere}`+'</style>';
    document.body.innerHTML=`<main><header><div><h1>Chronicle Memory <small>v0.7.2</small></h1><small>요약 연결 · 하이브리드 검색 · 사건 로그</small><br><small>© 2026 HyunnJg · <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">GPL-3.0</a> · 수정·재배포 가능 · 무보증</small></div><button id="close" class="secondary">닫기</button></header>
      <section><h2>이 기억은 어떻게 동작하나요?</h2><p>대화 원문을 설정한 턴 수만큼 묶어 짧은 사건 기록으로 바꾸고, 이전 사건 기록 전체와 최근 원문을 다음 RP 요청에 함께 보냅니다. 오래된 로그를 반복해서 다시 요약하지 않습니다.</p>
      <p><strong>단독·자체 하이브리드: 기본 5턴마다 기록 · 최근 원문 5턴.</strong> 완료된 대화가 12턴이고 T1~T10을 기록했다면, 누적 사건 로그 T1~T10 + 원문 T8~T12 + 현재 입력을 보냅니다. 요약 실패·미처리 구간은 원문으로 더 남깁니다.</p>
      <p><strong>Risu 기억 병행 · 하이파 주력</strong>은 원문 관리와 과거 검색을 Risu에 맡기고, 같은 주기로 만든 짧은 연대기를 덧붙입니다. 기본은 턴당 50글자 목표·누적 로그 전체 주입이며 최근 K청크·기록만도 선택할 수 있습니다. 기존 단독·자체 하이브리드 설정은 그대로 유지합니다.</p>
      <p><strong>단독</strong>은 위 구성을 사용합니다. <strong>하이브리드</strong>는 여기에 현재 대화와 관련된 요약 청크를 골라 최근 입력 가까이에 다시 보여줍니다. 오래된 원문은 검색하거나 다시 넣지 않습니다. 임베딩은 모델 내부 어텐션을 직접 조절하지 않습니다.</p>
      <p>청크 예: <strong>다음 만남의 약속 (1–5턴)</strong><br>다음 날 저녁 — 두 사람이 서점 앞에서 다시 만나기로 함.<br>요약 모델은 새 구간 전체만 읽고, 턴마다 따로 나누지 않고 사건별로 묶습니다. 시점은 원문에서 확인한 표현만 기록하며 없으면 생략합니다.</p>
      <p>1턴은 완료된 AI 응답 1개입니다. 사용자 입력 없이 별도 메시지로 진행한 응답도 각각 셉니다. 첫 인사·미응답 입력은 세지 않고, 같은 메시지에 붙인 이어쓰기·재생성은 턴 수를 늘리지 않습니다. 요약은 다음 RP 요청 직전에 별도로 호출하므로 비용·대기 시간이 추가될 수 있습니다. 원문 대화 자체는 삭제하지 않습니다. 전체 설정 저장 버튼과 모델 목록 조회는 이 화면 전체 설정을 함께 저장합니다.</p></section>
      <section><h2>요약 모델 연결 · 새 사건 청크 생성</h2>
      <label>제공자<select id="provider">${Object.entries(P.LABELS).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label>
      <div id="nativeOptions"><p>Risu 설정에 지정한 모델·키로 별도 요약 호출을 합니다. 보조모델과 기억 전용모델을 구분해서 선택하세요.</p>
      <label><input id="allowPlugins" type="checkbox"> 다른 플러그인이 제공하는 Risu 모델 호출 허용</label></div>
      <div id="externalOptions"><small id="autoAddress"></small>
      <div id="keyPanel"><label>API 키 · 저장 후에도 마스킹 상태로 유지<input id="apiKey" type="password" autocomplete="off"></label>
      <label><input id="showKey" type="checkbox"> 키 표시</label></div>
      <div id="vertexPanel"><div class="grid"><label>프로젝트 ID (JSON에서 자동 입력)<input id="project"></label><label>리전<input id="location" list="locations"><datalist id="locations"><option value="global"><option value="us-central1"><option value="us-east5"><option value="europe-west1"><option value="asia-northeast3"></datalist></label>
      <label>모델 제공자<select id="publisher"><option value="google">Google Gemini</option><option value="anthropic">Anthropic Claude</option></select></label></div>
      <label>서비스 계정 JSON 파일<input id="serviceFile" type="file" accept="application/json,.json"></label><label>서비스 계정 JSON (기기에만 저장)<textarea id="serviceAccount" rows="4"></textarea></label></div>
      <small id="keyState"></small><label><input id="clearKey" type="checkbox"> 이 제공자의 저장된 인증정보 삭제</label>
      <div id="endpointPanel"><label>API 기본 주소 또는 전체 Chat Completions 주소<input id="endpoint" placeholder="https://your-provider.example/v1"></label></div>
      <div class="row"><button id="loadModels" class="secondary">모델 목록 불러오기</button></div>
      <label>조회된 모델<select id="modelSelect"></select></label><label>선택한 모델 ID · 직접 수정 가능<input id="model"></label>
      <small>모델 목록은 해당 제공자에서 조회합니다. 목록에 있어도 프로젝트·리전별 실제 호출 권한은 연결 시험으로 확인하세요.</small>
      <div id="tokenPanel"><label>토큰 필드<select id="tokenField"><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label></div>
      <div id="versionPanel"><label>Anthropic API 버전<input id="anthropicVersion"></label></div></div>
      <label>추가 요약 지침 · 문체와 기록 우선순위<textarea id="customPrompt" rows="4" placeholder="예: 관계 변화·약속·취향을 우선하고 요약은 한국어로 작성"></textarea></label><small>청크 제목·기록 내용·키워드는 기본 형식이며 시점 표현은 선택입니다. 추가 지침에는 JSON 형식을 바꾸는 지시 대신 기록할 내용의 우선순위를 적으세요.</small>
      <div class="row"><button id="saveSettings">전체 설정 저장</button><button id="testConnection" class="secondary">요약 연결 시험 · 짧은 모델 호출</button></div>
      <p>연결 시험은 별도 모델 호출이며 소액 과금될 수 있습니다. API 키·서비스 계정 JSON은 기억 백업에 포함하지 않습니다.</p></section>
      <section><h2>플러그인 기본값 · 모듈에서 상속할 동작</h2><label><input id="enabled" type="checkbox"> 플러그인 기본값으로 기억 사용</label>
      <div class="grid"><label>요약 주기 (완료 턴)<input id="interval" type="number" min="5" max="20"></label>
      <label id="localRawSettings">유지할 최근 원문 (단독·자체 하이브리드)<input id="recent" type="number" min="5" max="20"></label>
      <label id="localSummaryTarget">턴당 평균 요약 목표 (단독·자체 하이브리드)<input id="charsPerTurn" type="number" min="50" max="200"></label>
      <label>구간 응답 토큰 상한/목표<input id="maxOutputTokens" type="number" min="128" max="8192"></label>
      <label>원문 처리<select id="mode"><option value="standalone">단독 · 누적 로그 + 최근 원문</option><option value="hybrid">자체 하이브리드 · 단독 + 청크 검색</option><option value="risu">Risu 기억 병행 · 하이파 주력</option></select></label>
      <label>요청당 최대 요약 묶음<input id="batchesPerRequest" type="number" min="1" max="20"></label>
      </div>
      <div id="risuSettings" hidden><h3>Risu 기억 병행 전용</h3><div class="grid">
      <label>병행 턴당 요약 목표 (10~200글자)<input id="risuCharsPerTurn" type="number" min="10" max="200"></label>
      <label>병행 연대기 주입<select id="risuLogScope"><option value="all">누적 로그 전체 (기본)</option><option value="recent">최근 K청크</option><option value="none">기록만 · 주입 안 함</option></select></label>
      <label id="risuChunkCount">최근 청크 수 K<input id="risuRecentChunks" type="number" min="1" max="100"></label></div>
      <p>하이파 등 내장 기억을 Risu에서 직접 켜세요. 원문과 과거 세부 검색은 Risu에 맡기며 이 플러그인은 원문을 자르거나 복원하지 않습니다. 연대기는 저장 원문에서 위 요약 주기마다 새 구간만 압축합니다. 기본 5턴 × 50글자면 본문 약 250글자이며 중요한 사실·추가 지침 때문에 넘겨도 수용합니다.</p>
      <p>전체 로그는 계속 저장합니다. 최근 K청크·기록만은 주입 범위만 바꾸며 백업·편집은 전체 기록을 유지합니다. 이미 저장한 로그는 다시 압축하지 않고 새 구간부터 병행 전용 목표를 적용합니다. 전체 주입 시 누적 로그만큼 입력은 늘며, 연대기는 내장 기억 처리 뒤에 추가되므로 최종 컨텍스트 여유를 Risu에서 확보하세요. 내장 기억이 먼저 제외한 미요약 원문을 연대기가 되살리지는 않습니다.</p></div>
      <label><input id="cleanSummaryInput" type="checkbox"> 요약 입력 정리: 이미지·BGM 등 장식 정리 · 구조화 상태 원문 유지</label>
      <p>구간 본문 권장 목표 = 요약 주기 × 해당 모드의 턴당 평균 글자 수. 중요한 사실·추가 지침 때문에 목표를 넘겨도 정상 요약은 자르거나 버리지 않고 저장합니다. 날짜·시간 표시와 제목·키워드는 본문 목표에서 제외합니다. 한 턴마다 같은 분량을 강제하지 않습니다. JSON 오류·잘못된 턴 범위·빈 본문·응답 잘림은 실패로 처리합니다. 단독·자체 하이브리드는 미요약 원문을 더 남기며, 병행의 원문 보존은 Risu 설정을 따릅니다.</p>
      <p>입력 정리는 알려진 표시용 장식을 정리하며 상태 JSON·사용자 정의 태그의 의미를 해석하지 않습니다. 정리를 끄면 원문 그대로 요약합니다. 작품별 상태 해석·언어·기록 우선순위는 추가 요약 지침에 적으세요. 원본 저장·전체 원문 변경 감지는 유지합니다.</p>
      <p>1턴 = 완료된 AI 응답 1개. 사용자 입력 없이 별도 메시지로 진행해도 각각 셉니다. 첫 인사와 같은 메시지의 이어쓰기·재생성은 추가 턴이 아닙니다. <strong>단독·자체 하이브리드는 Risu 내장 기억을 끄고, Risu 기억 병행은 하이파 등 내장 기억을 직접 켜세요.</strong> 병행에서는 자체 자동 검색·원문 자르기를 하지 않습니다.</p>
      <p>Risu 모델 호출은 Risu의 전역 출력 설정을 사용합니다. 위 토큰 수는 프롬프트 목표이며, 외부 API에서만 요청 필드로 전달합니다.</p>
      <p>전체 컨텍스트와 출력 토큰은 Risu·사용하는 API에서 설정합니다. 기본은 누적 로그 전체 주입이며 병행에서만 주입 범위를 선택할 수 있습니다. 별도의 누적 로그 글자 상한이나 응답 대기 시간 제한은 없습니다. 기록을 자동 삭제·병합·재요약하지 않습니다.</p>
      <p>모듈의 <strong>플러그인 기본값</strong>은 이 설정 전체를 따릅니다. <strong>모듈설정 사용</strong>은 기억을 켜고 모듈 입력값을 적용하며, 빈칸·잘못된 항목은 이 기본값을 따릅니다. <strong>중지</strong>는 요약·주입·검색을 멈춥니다. 변경은 다음 요청부터 반영됩니다.</p><small id="effectiveSettings"></small><p id="diagnostics" style="white-space:pre-wrap;overflow-wrap:anywhere" role="status"></p></section>
      <section><h2>하이브리드 검색 연결 · 요약 청크 재강조</h2>
      <p>요약 모델과 별도의 임베딩 모델을 지정합니다. 새로 만든 청크만 색인하고, 매턴 현재 입력·직전 대화 일부와 비교합니다. 단독 모드의 자동 요청에서는 임베딩 API를 호출하지 않습니다. 아래 연결·검색 시험은 모드와 무관하게 직접 실행합니다.</p>
      <label>임베딩 제공자<select id="embeddingProvider"><option value="gemini">Gemini AI Studio</option><option value="openai">OpenAI</option><option value="voyage">Voyage AI</option><option value="vertex">Vertex AI · Google 임베딩</option><option value="external">직접 입력 · OpenAI 호환 임베딩</option></select></label><small id="embeddingAddressHelp"></small>
      <small>Risu에 등록된 임베딩 모델 직접 호출은 현재 공개 API에서 확인되지 않아 지원하지 않습니다. 외부 API를 연결하세요. Anthropic 대화 모델은 임베딩 모델로 사용하지 않습니다.</small>
      <label id="embeddingReusePanel"><input id="embeddingReuseCredential" type="checkbox"> 같은 제공자에 저장한 요약 연결 인증정보 재사용</label><small id="embeddingCredentialState"></small>
      <div id="embeddingSeparateSecret"><small id="embeddingSecretHelp"></small><label>임베딩 전용 API 키 / 서비스 계정 JSON<input id="embeddingSecret" type="password" autocomplete="off"></label><label><input id="embeddingShowSecret" type="checkbox"> 인증정보 표시</label><label><input id="embeddingClearSecret" type="checkbox"> 이 제공자의 임베딩 전용 인증정보 삭제</label></div>
      <div id="embeddingEndpointPanel"><label>임베딩 API 기본 주소 또는 /embeddings 전체 주소<input id="embeddingEndpoint" placeholder="https://your-provider.example/v1"></label></div>
      <div id="embeddingVertexPanel" class="grid"><label>임베딩 프로젝트 ID · 빈칸이면 JSON 값<input id="embeddingProject"></label><label>임베딩 리전<input id="embeddingLocation"></label><label>Vertex 호출 형식<select id="embeddingVertexMethod"><option value="predict">predict · 텍스트 임베딩 모델</option><option value="embedContent">embedContent · 이를 지원하는 모델</option></select></label></div>
      <div class="row"><button id="loadEmbeddingModels" class="secondary">임베딩 모델 목록 불러오기</button></div>
      <label>선택 가능한 임베딩 모델<select id="embeddingModelSelect"></select></label><label>임베딩 모델 ID · 직접 수정 가능<input id="embeddingModel"></label>
      <small>Voyage는 공식 문서 기준의 내장 기본 목록이며 실시간 권한 조회가 아닙니다. 다른 제공자는 서버에서 조회합니다. 직접 입력 서버의 목록에는 임베딩 외 모델도 있을 수 있습니다. 모델·키·Vertex 리전의 실제 호출 가능 여부는 연결 시험으로 확인하세요.</small>
      <details><summary>검색 재강조 범위</summary><div class="grid"><label>최대 재강조 청크 수 (1~8)<input id="recallTopK" type="number" min="1" max="8"></label><label>다시 보여줄 기록의 최대 길이 (200~8000글자)<input id="recallCharBudget" type="number" min="200" max="8000"></label><label>의미 유사도 최소값 (0~1)<input id="recallMinSimilarity" type="number" min="0" max="1" step="0.05"></label><label>요청당 새로 색인할 청크 수 (1~32)<input id="embeddingBatchesPerRequest" type="number" min="1" max="32"></label></div><small>이 길이는 관련 기록을 추가로 반복해 보여주는 분량입니다. 누적 로그 전체는 별도로 계속 보냅니다.</small></details>
      <p>순위 = 의미 유사도 80% + 키워드 일치 비율 20%. 의미 기준을 넘거나 키워드가 일치한 청크만 후보로 삼습니다. 최근 원문 안에 완전히 포함된 청크는 재강조에서 제외하며, 예산에 청크 전체가 들어갈 때만 추가합니다. 검색 모델이 다르면 적절한 유사도 기준도 달라집니다.</p>
      <p>임베딩 미설정·실패 시 키워드 검색으로 계속하고 경고를 남깁니다. 과거 사실이 지금도 유효하다는 뜻은 아니므로 이후 변경 기록을 우선합니다. 모델 변경·청크 편집 시 필요한 벡터를 다시 만들며, 기존 요약은 다시 생성하지 않습니다.</p>
      <div class="row"><button id="saveEmbeddingSettings">전체 설정 저장</button><button id="testEmbedding" class="secondary">임베딩 연결 시험</button><button id="previewRecall" class="secondary">현재 대화 검색 시험</button><button id="resetEmbeddings" class="secondary">활성 청크 벡터 초기화</button></div>
      <p>연결·검색 시험은 API 호출 비용이 발생할 수 있습니다. 인증정보는 이 기기에만 보관하고 백업에서 제외합니다. 벡터는 요약과 분리한 검색 캐시에 보관하며 변경할 때만 저장합니다. 질의 벡터는 실행 중 메모리에만 두고, 기억 삭제 시 해당 검색 캐시도 함께 지웁니다.</p></section>
      <section><h2>현재 대화의 기억</h2><p id="chatTitle"></p><div class="row"><button id="reload" class="secondary">현재 대화 불러오기</button><button id="generate">미처리 구간 요약</button><button id="saveLog">수정한 로그 저장</button></div>
      <p>자동 처리는 새 구간을 덧붙입니다. 원문이 달라진 구간은 보관함으로 이동하며 RP에는 주입하지 않습니다.</p><div id="entries"></div>
      <div class="row"><button id="export" class="secondary">현재 대화 JSON 백업</button><button id="importButton" class="secondary">JSON 복원</button><input id="importFile" type="file" accept="application/json,.json" hidden></div>
      <p>복원 시 현재 원문과 맞는 구간만 활성화합니다. 기존 기억은 보관함에 남습니다. API 키·벡터·검색 결과는 백업하지 않으며 필요하면 다시 색인합니다.</p></section>
      <section><h2>누적 로그 · 검색 재강조 미리보기</h2><small id="counts"></small><textarea id="preview" rows="10" readonly></textarea><p id="recallState"></p><textarea id="recallPreview" rows="7" readonly placeholder="하이브리드에서 선택된 기존 요약 청크"></textarea></section><p id="status" role="status"></p></main>`;
    $('status').insertAdjacentHTML('beforebegin',`<section><h2>저장된 기억 · 캐시 관리</h2>
      <p>요약과 수동 편집 내용은 Risu 저장 데이터 안에 채팅별로 자동 보관합니다. 같은 채팅으로 돌아오면 JSON 파일 없이 다시 읽습니다. 별도의 txt 파일을 직접 찾아 지울 필요는 없습니다.</p>
      <label><input id="autoRestoreCache" type="checkbox"> 같은 캐릭터의 새 분기에서 공통 원문이 일치하는 기억 자동 재사용</label>
      <small>다른 내용의 새 채팅에는 과거 기록을 자동으로 붙이지 않습니다. 이 옵션을 끄더라도 각 채팅 자체의 저장 기록은 자동으로 불러옵니다.</small>
      <p><strong>삭제 위치:</strong> Risu 설정 → Chronicle Memory → 이 ‘저장된 기억 · 캐시 관리’ 영역. 삭제하면 선택한 기록과 보관함을 함께 지우며 원문·API 연결은 유지합니다. 다른 분기에 같은 기록이 남을 수 있으니 모두 없애려면 전체 삭제를 사용하세요.</p>
      <small id="cacheCount"></small><label>저장된 채팅<select id="cacheSelect"></select></label>
      <textarea id="cachePreview" rows="7" readonly placeholder="선택한 채팅의 사건 로그를 여기에서 확인할 수 있습니다."></textarea>
      <div class="row"><button id="reloadCaches" class="secondary">목록 새로고침</button><button id="reuseCache" class="secondary">선택 기록의 공통 구간 불러오기</button><button id="deleteCache" class="secondary">선택 기록 삭제</button><button id="deleteCurrent" class="secondary">현재 채팅 기억 삭제</button><button id="deleteAllCaches" class="secondary">전체 기억 삭제</button></div>
      <p>캐시는 대화를 이동해도 남습니다. Risu 저장 데이터를 초기화하거나 별도 저장본으로 바꾸면 달라질 수 있으므로 중요한 기록은 JSON 백업도 보관하세요. 삭제 후에도 자동 요약을 계속 사용하면 이후 기록은 다시 생성됩니다.</p></section>`);
    for(const key of Object.keys(C.DEFAULTS)) {if(!$(key)) continue; if(['enabled','allowPlugins','autoRestoreCache','cleanSummaryInput','embeddingReuseCredential'].includes(key)) $(key).checked=s[key];else $(key).value=s[key];}
    modeControls();$('mode').onchange=modeControls;$('risuLogScope').onchange=modeControls;
    await showConnection(s.provider);
    await showEmbedding(s.embeddingProvider);
    $('provider').onchange=async()=>{captureConnection();await showConnection($('provider').value);};
    $('embeddingProvider').onchange=async()=>{captureEmbedding();await showEmbedding($('embeddingProvider').value);};
    $('embeddingReuseCredential').onchange=embeddingReuseChanged;
    $('embeddingEndpoint').oninput=embeddingReuseChanged;$('endpoint').oninput=embeddingReuseChanged;
    $('embeddingShowSecret').onchange=()=>{$('embeddingSecret').type=$('embeddingShowSecret').checked?'text':'password';};
    $('embeddingModelSelect').onchange=()=>{
      if($('embeddingModelSelect').value){$('embeddingModel').value=$('embeddingModelSelect').value;
        if($('embeddingProvider').value==='vertex')$('embeddingVertexMethod').value=/^gemini-embedding-2(?:$|[-@])/.test($('embeddingModel').value)?'embedContent':'predict';}
    };
    $('showKey').onchange=()=>{$('apiKey').type=$('showKey').checked?'text':'password';};
    $('modelSelect').onchange=()=>{if($('modelSelect').value)$('model').value=$('modelSelect').value;};
    $('publisher').onchange=()=>{$('model').value='';$('modelSelect').replaceChildren(new Option('제공자 변경됨 · 목록을 다시 불러오세요',''));};
    $('serviceFile').onchange=async()=>{
      const file=$('serviceFile').files?.[0];if(!file)return;
      try{if(file.size>128*1024)throw Error('서비스 계정 JSON은 128KB 이하만 지원합니다.');
        const value=await file.text(),sa=P.serviceAccount(value);$('serviceAccount').value=value;if(sa.project_id)$('project').value=sa.project_id;notify('서비스 계정 JSON을 읽었습니다. 설정 저장을 누르세요.');
      }catch(e){notify(P.safeError(e));}
    };
    action('loadModels',async()=>{
      await saveSettings();const cfg=await config();notify('제공자에서 모델 목록을 불러오는 중…');
      const list=await P.models(api,cfg,await credential(cfg.provider));
      $('modelSelect').replaceChildren(new Option('모델을 선택하세요',''),...list.map(m=>new Option(m.name===m.id?m.id:`${m.name} · ${m.id}`,m.id)));
      if(list.some(m=>m.id===cfg.model))$('modelSelect').value=cfg.model;
      notify(`${list.length}개 모델을 불러왔습니다. 선택 후 설정 저장을 누르세요.`);
    });
    action('testConnection',async()=>{
      await saveSettings();const cfg=await config();notify('모델 연결을 시험하는 중…');
      await P.complete(api,{...cfg,maxOutputTokens:Math.max(cfg.maxOutputTokens,128)},await credential(cfg.provider),[{role:'system',content:'Return exactly the JSON object {"ok":true}. No other text.'},{role:'user',content:'Connection test.'}]);
      notify('연결 성공 · 모델에서 텍스트 응답을 받았습니다.');
    });
    $('close').onclick=()=>api.hideContainer();
    action('saveSettings',saveSettings);
    action('saveEmbeddingSettings',saveSettings);
    action('loadEmbeddingModels',async()=>{
      await saveSettings();const cfg=await config();notify('임베딩 모델 목록을 불러오는 중…');
      const list=await P.embeddingModels(api,cfg,await embeddingCredential(cfg));
      $('embeddingModelSelect').replaceChildren(new Option('임베딩 모델을 선택하세요',''),...list.map(m=>new Option(m.name===m.id?m.id:`${m.name} · ${m.id}`,m.id)));
      if(list.some(m=>m.id===cfg.embeddingModel))$('embeddingModelSelect').value=cfg.embeddingModel;
      notify(`${list.length}개 임베딩 모델${P.isVoyageEmbedding(cfg)?' · Voyage 기본 목록 (실시간 조회 아님)':''}을 불러왔습니다. 선택 후 전체 설정 저장을 누르세요.`);
    });
    action('testEmbedding',async()=>{
      await saveSettings();const cfg=await config();notify('임베딩 연결을 시험하는 중…');
      const vectors=await P.embed(api,cfg,await embeddingCredential(cfg),['두 사람이 다음 만남의 장소와 시간을 약속했다.']);
      notify(`임베딩 연결 성공 · ${vectors[0].length}차원 벡터를 받았습니다. 검색 품질은 실제 대화로 확인하세요.`);
    });
    action('previewRecall',async()=>{
      await saveSettings();const ctx=await context(),cfg=C.chatSettings(await config(),ctx.chat),state=C.reconcile(await stateFor(ctx),ctx.tl);
      if(!state.entries.length)throw Error('저장된 요약 청크가 없습니다. 먼저 미처리 구간을 요약하세요.');
      notify('현재 대화와 관련된 요약 청크를 검색하는 중…');
      const result=await recall(ctx,state,cfg,true);await loadEditor();
      notify(result.warnings.join('\n')||`검색 시험 완료 · ${result.info.selected.length}개 청크를 선택했습니다. RP 모델은 호출하지 않았습니다.`);
    });
    action('resetEmbeddings',async()=>{
      const ctx=await context(),state=await stateFor(ctx);
      await D.reset(ctx.key);embeddingFailedUntil.clear();await loadEditor();
      notify('현재 대화의 활성 청크 벡터만 초기화했습니다. 요약 본문·보관함은 유지하며 다음 하이브리드 요청에서 다시 색인합니다.');
    });
    action('reload',async()=>{await refreshEditor();await loadCaches();});
    $('cacheSelect').onchange=()=>{
      try{const row=selectedCache();$('cachePreview').value=row.state?C.memoryText(row.state):'이 기록을 읽을 수 없습니다. 삭제할 수는 있습니다.';}catch{$('cachePreview').value='';}
    };
    action('reloadCaches',loadCaches);
    action('reuseCache',async()=>{
      const row=selectedCache();if(!row.state)throw Error('읽을 수 없는 기록입니다.');
      const ctx=await context();
      if(row.meta.charId!==ctx.charId)throw Error('다른 캐릭터의 기억은 자동으로 연결하지 않습니다.');
      const next=C.compatiblePrefix(row.state,ctx.tl),old=await stateFor(ctx);
      if(!C.covered(next))throw Error('현재 대화와 일치하는 공통 원문 구간이 없습니다.');
      if(row.key===ctx.key) {await loadEditor();notify('현재 채팅의 저장된 기억을 불러왔습니다.');return;}
      if(C.covered(next)<=C.covered(C.reconcile(old,ctx.tl)))throw Error('현재 기억보다 더 긴 공통 구간이 없어 유지했습니다.');
      next.archive=old.archive;
      if(old.entries.length)next.archive.push({at:new Date().toISOString(),reason:'캐시에서 불러오기 전 기억',entries:old.entries});
      next.revision=old.revision+1;next.restoredFrom={key:row.key,at:new Date().toISOString(),automatic:false};
      await D.copy(row.key,ctx.key,next.entries);await persistState(ctx,next);await loadEditor();await loadCaches();notify(`공통 원문 T1~T${C.covered(next)} 기록을 불러왔습니다.`);
    });
    action('deleteCache',async()=>{
      const row=selectedCache();if(!confirm('선택한 채팅의 저장 기억과 보관함을 삭제할까요? 원문과 API 키는 유지합니다.'))return;
      await removeCached([row.key]);
    });
    action('deleteCurrent',async()=>{
      const ctx=await context();if(!confirm('현재 채팅의 저장 기억과 보관함을 삭제할까요? 원문과 API 키는 유지합니다.'))return;
      await removeCached([ctx.key]);
    });
    action('deleteAllCaches',async()=>{
      if(!confirm('모든 캐릭터·채팅의 Chronicle 기억과 보관함을 삭제할까요? 원문과 API 키는 유지합니다.'))return;
      await removeCached([...new Set([...(await cacheRows()).map(row=>row.key),...await D.derivedChats()])]);
    });
    action('generate',async()=>{
      await saveSettings();const ctx=await context();const cfg=C.chatSettings(await config(true),ctx.chat);
      notify('미처리 구간을 요약하고 있습니다…');
      const state=C.reconcile(await stateFor(ctx),ctx.tl);
      if(!C.nextBatch(state,ctx.tl,cfg).length) {
        const completed=ctx.tl.turns.length,covered=C.covered(state),remaining=completed-covered;
        await loadEditor();await loadCaches();
        notify(`요약 대기: 완료 ${completed}턴 · 요약 ${covered}턴 · 미처리 ${remaining}턴 / 주기 ${cfg.interval}턴. 새 응답 ${cfg.interval-remaining}턴이 더 완료되면 T${covered+1}~T${covered+cfg.interval}을 요약합니다. 첫 인사·미응답 입력·같은 메시지에 붙인 이어쓰기·재생성은 추가 턴으로 세지 않습니다.`);return;
      }
      await generate(ctx,await stateFor(ctx),cfg,true);await loadEditor();await loadCaches();
    });
    action('saveLog',async()=>{
      const next=structuredClone(await editorUnchanged());
      for(const area of document.querySelectorAll('[data-entry-id]')) {
        const e=next.entries.find(v=>v.id===area.dataset.entryId);
        if(!area.value.trim()) throw Error('구간을 빈 문자열로 저장할 수 없습니다. 기록 제외는 “기록 생략” 등으로 명시하세요.');
        if(e.text!==area.value) {e.text=area.value;e.editedAt=new Date().toISOString();delete e.embedding;}
      }
      for(const input of document.querySelectorAll('[data-title-id]')){
        const e=next.entries.find(v=>v.id===input.dataset.titleId),title=input.value.trim();
        if((e.title||'')!==title){e.title=title;e.editedAt=new Date().toISOString();delete e.embedding;}
      }
      for(const input of document.querySelectorAll('[data-keywords-id]')){
        const e=next.entries.find(v=>v.id===input.dataset.keywordsId),keywords=[...new Set(input.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean))];
        if(JSON.stringify(e.keywords||[])!==JSON.stringify(keywords)){e.keywords=keywords;e.editedAt=new Date().toISOString();delete e.embedding;}
      }
      next.summaryWarnings=[];await D.clearRecall(uiContext.key);next.revision++;C.validateState(next);await persistState(uiContext,next);await loadEditor();await loadCaches();notify('수정한 사건 로그 저장 완료');
    });
    action('export',async()=>{
      const latest=await editorUnchanged();download('Chronicle_Memory_Backup.json',{format:'risu-chronicle-backup',version:1,
        exportedAt:new Date().toISOString(),sourceKey:uiContext.key,charName:uiContext.charName,chatName:uiContext.chatName,state:C.stripDerivedState(latest)});notify('현재 대화 JSON 백업 완료');
    });
    $('importButton').onclick=()=>$('importFile').click();
    $('importFile').onchange=async()=>{
      const file=$('importFile').files?.[0];if(!file) return;
      try {await exclusive(async()=>{
        if(file.size>10*1024*1024) throw Error('백업 파일은 10MB 이하만 지원합니다.');
        const data=JSON.parse(await file.text());
        if(data.format!=='risu-chronicle-backup' || data.version!==1) throw Error('Chronicle 백업 형식이 아닙니다.');
        const ctx=await context(),old=await stateFor(ctx),restored=C.compatiblePrefix(C.validateState(data.state),ctx.tl);
        if(C.covered(restored)===0 && data.state.entries.length>0) throw Error('현재 대화와 일치하는 원문 구간이 없습니다. 복원하지 않았습니다.');
        if(old.entries.length || old.archive.length) restored.archive.push({at:new Date().toISOString(),reason:'복원 전 기억',entries:old.entries,previousArchive:old.archive});
        if(restored.entries.length<data.state.entries.length)restored.archive.push({at:new Date().toISOString(),reason:'복원 원문과 일치하지 않는 후속 기억',entries:data.state.entries.slice(restored.entries.length)});
        restored.archive.push(...(data.state.archive || []));
        restored.revision=old.revision+1;await persistState(ctx,restored);await loadEditor();await loadCaches();notify('원문과 일치하는 기억을 복원했습니다.');
      });}catch(e){notify(e.message);}finally{$('importFile').value='';}
    };
    await refreshEditor();try{await loadCaches();}catch(e){notify(P.safeError(e));}
    await api.showContainer('fullscreen');
  }
  await api.addRisuReplacer('beforeRequest',beforeRequest);
  await api.registerSetting('Chronicle Memory',()=>exclusive(open),'📜','html');
  await api.registerButton({name:'Chronicle Memory',icon:'📜',iconType:'html',location:'chat'},()=>exclusive(open));
})();
