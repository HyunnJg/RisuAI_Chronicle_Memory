// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
/* Provider adapters. Credentials stay in the caller's device-local store. */
const ChronicleProviders=(()=>{
  'use strict';
  const NATIVE=['main','memory','submodel'];
  const LABELS={main:'Risu 메인모델',memory:'Risu 기억 전용모델',submodel:'Risu 보조모델',openai:'OpenAI',gemini:'Gemini AI Studio',anthropic:'Anthropic',vertex:'Vertex AI',external:'직접 입력 · OpenAI 호환'};
  // Documented text-embedding models, not a live account/availability lookup.
  const VOYAGE_MODELS=Object.freeze(['voyage-4-large','voyage-4','voyage-4-lite','voyage-code-4','voyage-3-large','voyage-3.5','voyage-3.5-lite','voyage-code-3','voyage-finance-2','voyage-law-2']);
  const tokenCache=new Map();
  function safeError(error,secrets=[]) {
    let text=typeof error==='string'?error:error?.message || JSON.stringify(error) || '알 수 없는 오류';
    for(const secret of secrets.filter(x=>typeof x==='string'&&x.length>3)) text=text.split(secret).join('[숨김]');
    return text.replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,'[개인키 숨김]')
      .replace(/(Bearer\s+|(?:api[_-]?key|access_token|assertion)["'\s:=]+)[^\s"'&,}]+/gi,'$1[숨김]')
      .replace(/\b(?:AIza[\w-]{12,}|sk-[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,'[키/토큰 숨김]').slice(0,900);
  }
  function defaults(provider) {
    return {endpoint:provider==='openai'?'https://api.openai.com/v1/chat/completions':provider==='gemini'?'https://generativelanguage.googleapis.com/v1beta':provider==='anthropic'?'https://api.anthropic.com/v1/messages':'',
      model:'',project:'',location:'global',publisher:'google',tokenField:provider==='openai'?'max_completion_tokens':'max_tokens',anthropicVersion:'2023-06-01'};
  }
  function compatibleURL(value) {
    let url;
    try{url=new URL(value.trim());}catch{throw Error('API 기본 주소 또는 Chat Completions 전체 주소를 입력하세요.');}
    if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('원격 API는 HTTPS를 사용하세요.');
    if(url.username||url.password||url.search||url.hash)throw Error('API 주소에서 인증정보·쿼리·해시를 제거하세요.');
    if(['googleapis.com','www.googleapis.com'].includes(url.hostname))throw Error('Gemini AIS 주소는 generativelanguage.googleapis.com 입니다. 제공자 선택에서 Gemini AI Studio를 사용하세요.');
    let path=url.pathname.replace(/\/+$/,'');
    if(path.endsWith('/responses'))throw Error('직접 입력은 Chat Completions 형식입니다. /responses 대신 /chat/completions를 사용하세요.');
    if(!path.endsWith('/chat/completions')) path+=(path===''?'/v1':'')+'/chat/completions';
    url.pathname=path;return url.toString();
  }
  const modelID=id=>{
    const value=String(id||'').trim().replace(/^(?:publishers\/[^/]+\/)?models\//,'');
    if(!value || !/^[\w.\-:@/]+$/.test(value))throw Error('모델을 선택하거나 올바른 모델 ID를 입력하세요.');
    return value;
  };
  function vertexHost(location){
    if(!/^[a-z0-9-]+$/.test(location))throw Error('Vertex 리전 형식을 확인하세요.');
    return location==='global'?'https://aiplatform.googleapis.com':`https://${location}-aiplatform.googleapis.com`;
  }
  const b64url=bytes=>{
    let str='';for(const b of bytes)str+=String.fromCharCode(b);
    return btoa(str).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  };
  const json64=value=>b64url(new TextEncoder().encode(JSON.stringify(value)));
  function serviceAccount(value) {
    let sa;
    try{sa=typeof value==='string'?JSON.parse(value):value;}catch{throw Error('Vertex 서비스 계정 JSON을 해석할 수 없습니다.');}
    if(sa?.type!=='service_account'||typeof sa.client_email!=='string'||typeof sa.private_key!=='string'||!sa.private_key.includes('BEGIN PRIVATE KEY'))throw Error('type=service_account, client_email, private_key가 있는 JSON이 필요합니다.');
    return sa;
  }
  async function request(api,url,options,secrets=[]) {
    let response;
    try{response=await api.nativeFetch(url,options);}catch(e){throw Error('API 통신 실패: '+safeError(e,secrets));}
    let body;
    try{const text=await response.text();try{body=JSON.parse(text);}catch{body={error:{message:text.slice(0,500)}};}}
    catch(e){throw Error('API 응답 읽기 실패: '+safeError(e,secrets));}
    if(!response.ok||body?.error){
      const detail=body?.error?.message||body?.detail||body?.message||body?.error_description||body?.error||
        (typeof body==='string'?body:'')||response.statusText||'응답 오류';
      throw Error(`HTTP ${response.status}: ${safeError(detail,secrets)}`);
    }
    return body;
  }
  async function vertexToken(api,credential) {
    const sa=serviceAccount(credential),cacheKey=sa.client_email+'\n'+sa.private_key;
    const cached=tokenCache.get(cacheKey);if(cached?.expires>Date.now()+60000)return {token:cached.token,sa};
    const now=Math.floor(Date.now()/1000),pem=sa.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    let key;
    try{key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);}
    catch{throw Error('Vertex JSON의 RSA 개인키 형식을 확인하세요.');}
    const input=json64({alg:'RS256',typ:'JWT'})+'.'+json64({iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(input)));
    const assertion=input+'.'+b64url(signature);
    const data=await request(api,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()},[sa.private_key,assertion]);
    if(typeof data.access_token!=='string')throw Error('Vertex OAuth 응답에 액세스 토큰이 없습니다.');
    tokenCache.set(cacheKey,{token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000});
    return {token:data.access_token,sa};
  }
  function googleBody(messages,limit) {
    return {systemInstruction:{parts:[{text:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')}]},
      contents:messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),
      generationConfig:{maxOutputTokens:limit,responseMimeType:'application/json',thinkingConfig:{includeThoughts:false}}};
  }
  function claudeBody(messages,limit,model,vertex=false) {
    return {...(vertex?{anthropic_version:'vertex-2023-10-16'}:{model}),max_tokens:limit,stream:false,
      system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),
      messages:messages.filter(m=>m.role!=='system').map(({role,content})=>({role,content}))};
  }
  function extractGoogle(data) {
    const candidate=data.candidates?.[0];
    if(candidate?.finishReason==='MAX_TOKENS')throw Error('요약 출력이 토큰 상한으로 잘렸습니다. 상한을 늘리세요.');
    const text=candidate?.content?.parts?.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('');
    if(!text)throw Error('Gemini 응답에 텍스트가 없습니다: '+safeError(data.promptFeedback?.blockReason||candidate?.finishReason||'빈 응답'));
    return text;
  }
  function extractClaude(data) {
    if(data.stop_reason==='max_tokens')throw Error('요약 출력이 토큰 상한으로 잘렸습니다. 상한을 늘리세요.');
    const text=data.content?.filter(p=>p.type==='text').map(p=>p.text).join('');
    if(!text)throw Error('Anthropic 응답에 텍스트가 없습니다.');return text;
  }
  async function nativeText(value) {
    if(typeof value==='string')return value;
    if(value?.type==='fail'||value?.error)throw Error('Risu 모델 응답: '+safeError(value.result||value.error));
    if(value?.type==='success' && typeof value.result==='string')return value.result;
    if(value?.type==='multiline' && Array.isArray(value.result)){
      const rows=value.result.filter(r=>['char','assistant'].includes(r[0]));
      if(rows.length===1)return rows[0][1];
      throw Error('Risu에서 여러 응답을 반환했습니다. 동시 생성 수를 1로 설정하세요.');
    }
    if(value?.type==='streaming'&&value.result?.getReader){
      const reader=value.result.getReader();let result='';
      try{while(true){const {done,value:chunk}=await reader.read();if(done)break;
        if(typeof chunk==='string')result+=chunk;
        else if(chunk&&typeof chunk==='object'&&chunk.thought!==true&&!['thinking','thought','reasoning','reasoning_content'].includes(chunk.type)){
          const texts=Object.entries(chunk).filter(([key,v])=>/^\d+$/.test(key)&&typeof v==='string').map(([,v])=>v);
          if(texts.length)result=texts.join('');
          else if(typeof chunk.text==='string')result=chunk.text;
          else if(typeof chunk.content==='string')result=chunk.content;
        }
      }}finally{reader.releaseLock();}
      if(result)return result;
    }
    throw Error('Risu 모델 응답 형식을 처리할 수 없습니다: '+safeError({type:value?.type,keys:value&&Object.keys(value)}));
  }
  async function complete(api,s,credential,messages) {
    if(NATIVE.includes(s.provider)){
      const nativeMessages=messages.map(m=>({...m}));nativeMessages[0].memo='risu-chronicle-summary-v1';
      try{return await nativeText(await api.runLLMModel({messages:nativeMessages,mode:s.provider==='main'?'model':s.provider==='memory'?'memory':'submodel',allowPlugins:!!s.allowPlugins}));}
      catch(e){throw Error('Risu 요약 호출 실패 ('+LABELS[s.provider]+'): '+safeError(e));}
    }
    const model=modelID(s.model);let url,headers={'Content-Type':'application/json'},body;
    if(s.provider==='gemini'){
      if(!credential)throw Error('Gemini AI Studio API 키를 입력하세요.');
      url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';headers['x-goog-api-key']=credential;body=googleBody(messages,s.maxOutputTokens);
    }else if(s.provider==='anthropic'){
      if(!credential)throw Error('Anthropic API 키를 입력하세요.');
      url='https://api.anthropic.com/v1/messages';headers['x-api-key']=credential;headers['anthropic-version']=s.anthropicVersion;body=claudeBody(messages,s.maxOutputTokens,model);
    }else if(s.provider==='vertex'){
      const auth=await vertexToken(api,credential),project=s.project||auth.sa.project_id;
      if(!project || !/^[\w:.-]+$/.test(project))throw Error('Vertex 프로젝트 ID가 필요합니다.');
      headers.Authorization='Bearer '+auth.token;
      url=vertexHost(s.location)+'/v1/projects/'+encodeURIComponent(project)+'/locations/'+s.location+'/publishers/'+s.publisher+'/models/'+encodeURIComponent(model)+(s.publisher==='anthropic'?':rawPredict':':generateContent');
      body=s.publisher==='anthropic'?claudeBody(messages,s.maxOutputTokens,model,true):googleBody(messages,s.maxOutputTokens);
    }else{
      url=s.provider==='openai'?defaults('openai').endpoint:compatibleURL(s.endpoint);
      if(s.provider==='openai'&&!credential)throw Error('OpenAI API 키를 입력하세요.');
      if(credential)headers.Authorization='Bearer '+credential;
      body={model,messages:messages.map(({role,content})=>({role,content})),stream:false,[s.provider==='openai'?'max_completion_tokens':s.tokenField]:s.maxOutputTokens};
    }
    const data=await request(api,url,{method:'POST',headers,body:JSON.stringify(body)},[credential]);
    if(s.provider==='gemini'||(s.provider==='vertex'&&s.publisher==='google'))return extractGoogle(data);
    if(s.provider==='anthropic'||(s.provider==='vertex'&&s.publisher==='anthropic'))return extractClaude(data);
    if(data.choices?.[0]?.finish_reason==='length')throw Error('요약 출력이 토큰 상한으로 잘렸습니다. 상한을 늘리세요.');
    const value=data.choices?.[0]?.message?.content;
    const text=typeof value==='string'?value:Array.isArray(value)?value.filter(p=>p.type==='text').map(p=>p.text).join(''):'';
    if(!text)throw Error('Chat Completions 응답에 텍스트가 없습니다.');return text;
  }
  async function models(api,s,credential) {
    if(NATIVE.includes(s.provider))throw Error('Risu 내부 모델은 Risu 설정에서 선택하세요.');
    let url,headers={},result=[],pages=0;
    if(s.provider==='gemini'){
      if(!credential)throw Error('Gemini API 키를 입력하세요.');
      url='https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';headers['x-goog-api-key']=credential;
    }else if(s.provider==='anthropic'){
      if(!credential)throw Error('Anthropic API 키를 입력하세요.');
      url='https://api.anthropic.com/v1/models?limit=1000';headers={'x-api-key':credential,'anthropic-version':s.anthropicVersion};
    }else if(s.provider==='vertex'){
      const auth=await vertexToken(api,credential);headers.Authorization='Bearer '+auth.token;
      url=vertexHost(s.location)+'/v1beta1/publishers/'+s.publisher+'/models?pageSize=1000&listAllVersions=true';
    }else{
      url=(s.provider==='openai'?defaults('openai').endpoint:compatibleURL(s.endpoint)).replace(/\/chat\/completions$/,'/models');
      if(credential)headers.Authorization='Bearer '+credential;
    }
    while(url&&pages++<20){
      const data=await request(api,url,{method:'GET',headers},[credential]);
      if(s.provider==='gemini') result.push(...(data.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>({id:m.name.replace(/^models\//,''),name:m.displayName||m.name})));
      else if(s.provider==='vertex')result.push(...(data.publisherModels||[]).map(m=>({id:m.name.replace(/^.*\/models\//,''),name:m.displayName||m.name.split('/').at(-1)})).filter(m=>s.publisher==='anthropic'?/claude/i.test(m.id):/gemini/i.test(m.id)));
      else result.push(...(data.data||[]).filter(m=>s.provider!=='openai'||(/^(gpt-|o\d|chatgpt-)/.test(m.id)&&!/audio|realtime|image|transcri|tts|embedding|moderation/.test(m.id))).map(m=>({id:m.id,name:m.display_name||m.id})));
      if(data.nextPageToken){const next=new URL(url);next.searchParams.set('pageToken',data.nextPageToken);url=next.toString();}
      else if(data.has_more && data.last_id){const next=new URL(url);next.searchParams.set('after_id',data.last_id);url=next.toString();}
      else url=null;
    }
    if(url)throw Error('모델 목록이 20페이지를 초과했습니다. 모델 ID를 직접 입력하세요.');
    const unique=[...new Map(result.filter(m=>typeof m.id==='string').map(m=>[m.id,m])).values()].sort((a,b)=>a.id.localeCompare(b.id));
    if(!unique.length)throw Error('조회한 목록에 선택 가능한 모델이 없습니다. 직접 모델 ID를 입력할 수 있습니다.');
    return unique;
  }
  function embeddingURL(value){
    // Reuse the same origin/credential checks as Chat Completions, then choose /embeddings.
    const input=String(value||'').trim();
    return /\/embeddings\/?$/.test(input)?compatibleURL(input).replace(/\/chat\/completions$/,''):
      compatibleURL(input).replace(/\/chat\/completions$/,'/embeddings');
  }
  function isVoyageURL(value){
    try{const url=new URL(embeddingURL(value));return url.origin==='https://api.voyageai.com'&&url.pathname==='/v1/embeddings';}catch{return false;}
  }
  const isVoyageEmbedding=s=>s.embeddingProvider==='voyage'||(s.embeddingProvider==='external'&&isVoyageURL(s.embeddingEndpoint));
  function canReuseExternalCredential(s){
    try{
      const summary=s.provider==='external'?s.endpoint:s.profiles?.external?.endpoint;
      return new URL(compatibleURL(summary||'')).origin===new URL(embeddingURL(s.embeddingEndpoint)).origin;
    }catch{return false;}
  }
  function checkVectors(vectors,count){
    if(!Array.isArray(vectors)||vectors.length!==count||!vectors.length)throw Error('임베딩 응답의 개수가 입력과 다릅니다.');
    const dimensions=vectors[0]?.length;
    if(!dimensions||dimensions>32768||vectors.some(v=>!Array.isArray(v)||v.length!==dimensions||v.some(n=>!Number.isFinite(n))||!v.some(n=>n!==0)))throw Error('임베딩 벡터가 비어 있거나 차원·숫자 형식이 올바르지 않습니다.');
    return vectors;
  }
  function embeddingGoogleBody(model,text,kind){
    const modern=/^gemini-embedding-2(?:$|[-@])/.test(model);
    const content=modern?(kind==='query'?'Represent this search query for retrieving relevant roleplay event records: ':'Represent this roleplay event record for retrieval: ')+text:text;
    return {content:{parts:[{text:content}]},embedContentConfig:{autoTruncate:false,...(!modern&&model!=='embedding-001'?{taskType:kind==='query'?'RETRIEVAL_QUERY':'RETRIEVAL_DOCUMENT'}:{})}};
  }
  async function embed(api,s,credential,texts,kind='document'){
    if(!Array.isArray(texts)||!texts.length||texts.some(t=>typeof t!=='string'||!t.trim()))throw Error('임베딩할 텍스트가 없습니다.');
    const provider=s.embeddingProvider,model=modelID(s.embeddingModel),headers={'Content-Type':'application/json'};
    if(['openai','external','voyage'].includes(provider)){
      if(provider==='openai'&&!credential)throw Error('OpenAI 임베딩 API 키를 입력하세요.');
      const voyage=isVoyageEmbedding(s);
      if(voyage&&!credential)throw Error('Voyage AI 임베딩 API 키를 입력하세요.');
      if(credential)headers.Authorization='Bearer '+credential;
      const url=provider==='openai'?'https://api.openai.com/v1/embeddings':provider==='voyage'?'https://api.voyageai.com/v1/embeddings':embeddingURL(s.embeddingEndpoint);
      const body=voyage?{model,input:texts,input_type:kind==='query'?'query':'document',output_dtype:'float',truncation:false}:
        {model,input:texts,encoding_format:'float'};
      const data=await request(api,url,{method:'POST',headers,body:JSON.stringify(body)},[credential]);
      if(!Array.isArray(data.data)||data.data.length!==texts.length)throw Error('임베딩 응답 개수 오류');
      const rows=[...data.data].sort((a,b)=>a.index-b.index);
      if(rows.some((r,i)=>r.index!==i))throw Error('임베딩 응답 순서/인덱스 오류');
      return checkVectors(rows.map(r=>r.embedding),texts.length);
    }
    let auth,project;
    if(provider==='gemini'){
      if(!credential)throw Error('Gemini 임베딩 API 키를 입력하세요.');headers['x-goog-api-key']=credential;
    }else if(provider==='vertex'){
      auth=await vertexToken(api,credential);project=s.embeddingProject||auth.sa.project_id;
      if(!project||!/^[\w:.-]+$/.test(project))throw Error('Vertex 임베딩 프로젝트 ID가 필요합니다.');
      headers.Authorization='Bearer '+auth.token;
    }else throw Error('지원하지 않는 임베딩 제공자');
    const vectors=[];
    // One input per request also supports Vertex models that accept a single instance.
    for(const text of texts){
      let url,body;
      if(provider==='gemini'){
        url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':embedContent';
        body=embeddingGoogleBody(model,text,kind);
      }else{
        const method=s.embeddingVertexMethod;
        url=vertexHost(s.embeddingLocation)+'/v1/projects/'+encodeURIComponent(project)+'/locations/'+s.embeddingLocation+'/publishers/google/models/'+encodeURIComponent(model)+':'+method;
        body=method==='predict'?{instances:[{content:text,task_type:kind==='query'?'RETRIEVAL_QUERY':'RETRIEVAL_DOCUMENT'}],parameters:{autoTruncate:false}}:embeddingGoogleBody(model,text,kind);
      }
      const data=await request(api,url,{method:'POST',headers,body:JSON.stringify(body)},[credential,auth?.token]);
      if(data.truncated||data.predictions?.[0]?.embeddings?.statistics?.truncated)throw Error(' 임베딩 입력이 잘렸습니다. 청크 분량이나 모델을 확인하세요.');
      vectors.push(data.embedding?.values||data.predictions?.[0]?.embeddings?.values);
    }
    return checkVectors(vectors,texts.length);
  }
  async function embeddingModels(api,s,credential){
    if(isVoyageEmbedding(s))return VOYAGE_MODELS.map(id=>({id,name:id}));
    const provider=s.embeddingProvider;let url,headers={},result=[];
    if(provider==='gemini'){
      if(!credential)throw Error('Gemini 임베딩 API 키를 입력하세요.');
      headers['x-goog-api-key']=credential;url='https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
    }else if(provider==='vertex'){
      const auth=await vertexToken(api,credential);headers.Authorization='Bearer '+auth.token;
      url=vertexHost(s.embeddingLocation)+'/v1beta1/publishers/google/models?pageSize=1000&listAllVersions=true';
    }else{
      if(provider==='openai'&&!credential)throw Error('OpenAI 임베딩 API 키를 입력하세요.');
      if(credential)headers.Authorization='Bearer '+credential;
      url=(provider==='openai'?'https://api.openai.com/v1/embeddings':embeddingURL(s.embeddingEndpoint)).replace(/\/embeddings$/,'/models');
    }
    for(let page=0;url&&page<20;page++){
      const data=await request(api,url,{method:'GET',headers},[credential]);
      const rows=provider==='gemini'?(data.models||[]).filter(m=>m.supportedGenerationMethods?.includes('embedContent')):
        provider==='vertex'?(data.publisherModels||[]).filter(m=>/embedding/i.test(m.name)&&!/multimodal/i.test(m.name)):
        (data.data||[]).filter(m=>provider==='external'||/embed/i.test(m.id));
      result.push(...rows.map(m=>({id:(m.id||m.name).replace(/^(?:.*\/)?models\//,''),name:m.displayName||m.display_name||m.id||m.name})));
      if(data.nextPageToken){const next=new URL(url);next.searchParams.set('pageToken',data.nextPageToken);url=next.toString();}else url=null;
    }
    if(url)throw Error('임베딩 모델 목록이 20페이지를 넘었습니다. 모델 ID를 직접 입력하세요.');
    if(!result.length)throw Error('조회된 임베딩 모델이 없습니다. 지원되는 모델 ID를 직접 입력할 수 있습니다.');
    return [...new Map(result.map(m=>[m.id,m])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  return {NATIVE,LABELS,defaults,compatibleURL,safeError,serviceAccount,vertexToken,googleBody,claudeBody,nativeText,complete,models,
    embeddingURL,isVoyageURL,isVoyageEmbedding,canReuseExternalCredential,VOYAGE_MODELS,checkVectors,embeddingGoogleBody,embed,embeddingModels};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ChronicleProviders;
