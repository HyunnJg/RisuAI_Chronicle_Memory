// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const P=require('../providers.cjs'),C=require('../core.cjs');
function transport(responses){const calls=[];return {calls,api:{nativeFetch:async(url,options)=>{
  calls.push({url,options});const item=responses.shift();if(!item)throw Error('Unexpected mocked request');
  return new Response(JSON.stringify(item.body),{status:item.status||200});
}}};}
test('embedding URLs accept base or full endpoint and reject credential-bearing URLs',()=>{
  for(const [input,expected] of [['https://example.org','https://example.org/v1/embeddings'],['https://example.org/embeddings','https://example.org/embeddings'],
    ['https://example.org/v1/embeddings','https://example.org/v1/embeddings'],['https://example.org/v1/chat/completions','https://example.org/v1/embeddings'],['http://localhost:5000/v1','http://localhost:5000/v1/embeddings']])assert.equal(P.embeddingURL(input),expected);
  for(const input of ['https://example.org/v1?key=secret','https://key:secret@example.org/v1','http://remote.example/v1'])assert.throws(()=>P.embeddingURL(input));
});
test('OpenAI-compatible embeddings use float vectors and restore the documented input order',async()=>{
  const h=transport([{body:{data:[{index:1,embedding:[0,1]},{index:0,embedding:[1,0]}]}}]);
  const cfg=C.settings({embeddingProvider:'external',embeddingEndpoint:'https://example.org/v1',embeddingModel:'org/embed'});
  assert.deepEqual(await P.embed(h.api,cfg,'EMBED_SECRET',['문서 A','문서 B']),[[1,0],[0,1]]);
  const body=JSON.parse(h.calls[0].options.body);assert.equal(body.encoding_format,'float');assert.deepEqual(body.input,['문서 A','문서 B']);assert.equal(body.model,'org/embed');
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer EMBED_SECRET');
});
test('Gemini AI Studio embeddings use batchEmbedContents with per-request retrieval tasks and modern instructions',async()=>{
  const cfg=C.settings({embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001'});
  const h=transport([{body:{embeddings:[{values:[1,0]}]}},{body:{embeddings:[{values:[0,1]}]}},{body:{embeddings:[{values:[1,1]}]}}]);
  await P.embed(h.api,cfg,'AIS_KEY',['문서']);await P.embed(h.api,cfg,'AIS_KEY',['질의'],'query');
  await P.embed(h.api,{...cfg,embeddingModel:'gemini-embedding-2'},'AIS_KEY',['질의'],'query');
  const [doc,query,modern]=h.calls.map(c=>JSON.parse(c.options.body).requests[0]);
  assert.deepEqual(doc,{model:'models/gemini-embedding-001',content:{parts:[{text:'문서'}]},taskType:'RETRIEVAL_DOCUMENT'});
  assert.equal(query.taskType,'RETRIEVAL_QUERY');
  assert.equal(h.calls[0].options.headers['x-goog-api-key'],'AIS_KEY');assert.match(h.calls[0].url,/\/models\/gemini-embedding-001:batchEmbedContents$/);
  // Vertex-only fields are never sent to AI Studio.
  for(const row of [doc,query,modern])assert(!('embedContentConfig' in row)&&!('autoTruncate' in row));
  assert(!('taskType' in modern));assert.match(modern.content.parts[0].text,/Represent this search query/);
});
test('v0.8.0 Gemini batches split at 100 inputs, keep order, and reject count mismatches',async()=>{
  const cfg=C.settings({embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001'});
  const texts=Array.from({length:150},(_,i)=>`문서 ${i}`),vector=i=>[i+1,1];
  const h=transport([{body:{embeddings:texts.slice(0,100).map((_,i)=>({values:vector(i)}))}},{body:{embeddings:texts.slice(100).map((_,i)=>({values:vector(100+i)}))}}]);
  const out=await P.embed(h.api,cfg,'AIS_KEY',texts);
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls.map(c=>JSON.parse(c.options.body).requests.length),[100,50]);
  assert.equal(JSON.parse(h.calls[1].options.body).requests[0].content.parts[0].text,'문서 100');
  assert.deepEqual(out,texts.map((_,i)=>vector(i)));
  let bad=transport([{body:{embeddings:[{values:[1,0]}]}}]);await assert.rejects(()=>P.embed(bad.api,cfg,'AIS_KEY',['가','나']),/개수/);
  bad=transport([{body:{embeddings:texts.slice(0,100).map(()=>({values:[1,0]}))}},{body:{embeddings:[{values:[1,0]}]}}]);
  await assert.rejects(()=>P.embed(bad.api,cfg,'AIS_KEY',texts),/개수/);assert.equal(bad.calls.length,2);
  bad=transport([{body:{}}]);await assert.rejects(()=>P.embed(bad.api,cfg,'AIS_KEY',['가']),/개수/);
});
test('v0.8.0 Vertex embeddings stay one request per input',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const sa=JSON.stringify({type:'service_account',project_id:'p',client_email:'a@p.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://oauth2.googleapis.com/token'});
  const h=transport([{body:{access_token:'TOKEN',expires_in:3600}},{body:{predictions:[{embeddings:{values:[1,0]}}]}},{body:{predictions:[{embeddings:{values:[0,1]}}]}},{body:{predictions:[{embeddings:{values:[1,1]}}]}}]);
  const cfg=C.settings({embeddingProvider:'vertex',embeddingModel:'gemini-embedding-001',embeddingLocation:'us-central1',embeddingProject:'p'});
  assert.deepEqual(await P.embed(h.api,cfg,sa,['a','b','c']),[[1,0],[0,1],[1,1]]);
  assert.equal(h.calls.filter(c=>/:predict$/.test(c.url)).length,3);
  for(const call of h.calls.slice(1))assert.equal(JSON.parse(call.options.body).instances.length,1);
});
test('invalid vectors, missing indices, truncation and HTTP errors are explicit and redact credentials',async()=>{
  for(const vectors of [[],[[0,0]],[[NaN,1]],[[1,0],[1]],['encoded']])assert.throws(()=>P.checkVectors(vectors,1));
  const cfg=C.settings({embeddingProvider:'gemini',embeddingModel:'test-embed'});
  let h=transport([{body:{embeddings:[{values:[1,0],truncated:true}]}}]);await assert.rejects(()=>P.embed(h.api,cfg,'TEST_SECRET',['문서']),/잘렸/);
  h=transport([{status:401,body:{error:{message:'Invalid TEST_SECRET'}}}]);await assert.rejects(()=>P.embed(h.api,cfg,'TEST_SECRET',['문서']),e=>/401/.test(e.message)&&!e.message.includes('TEST_SECRET'));
  h=transport([{body:{data:[{index:1,embedding:[1,0]}]}}]);await assert.rejects(()=>P.embed(h.api,{...cfg,embeddingProvider:'openai'},'KEY',['문서']),/인덱스/);
});
test('embedding model lists paginate and distinguish Gemini generation models from embeddings',async()=>{
  const h=transport([{body:{models:[{name:'models/generate',supportedGenerationMethods:['generateContent']},{name:'models/embed-a',supportedGenerationMethods:['embedContent']}],nextPageToken:'next'}},
    {body:{models:[{name:'models/embed-b',supportedGenerationMethods:['embedContent']}]}}]);
  const list=await P.embeddingModels(h.api,C.settings(),'KEY');assert.deepEqual(list.map(m=>m.id),['embed-a','embed-b']);assert.match(h.calls[1].url,/pageToken=next/);
  const openai=transport([{body:{data:[{id:'gpt-chat'},{id:'text-embedding-3-small'}]}}]);
  assert.deepEqual((await P.embeddingModels(openai.api,C.settings({embeddingProvider:'openai'}),'KEY')).map(m=>m.id),['text-embedding-3-small']);
});
test('Vertex embeddings authenticate and support predict and embedContent without sending private keys',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),sa=JSON.stringify({type:'service_account',client_email:'embedding@example.invalid',project_id:'project-test',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  const h=transport([{body:{access_token:'VERTEX_EMBED_TOKEN',expires_in:3600}},
    {body:{predictions:[{embeddings:{values:[1,0],statistics:{truncated:false}}}]}},{body:{embedding:{values:[0,1]},truncated:false}}]);
  const s=C.settings({embeddingProvider:'vertex',embeddingModel:'gemini-embedding-001'});
  assert.deepEqual(await P.embed(h.api,s,sa,['문서']),[[1,0]]);
  assert.deepEqual(await P.embed(h.api,{...s,embeddingModel:'gemini-embedding-2',embeddingVertexMethod:'embedContent'},sa,['질의'],'query'),[[0,1]]);
  assert.equal(h.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,1);
  assert.match(h.calls[1].url,/us-central1-aiplatform.googleapis.com.*:predict$/);
  const predict=JSON.parse(h.calls[1].options.body);assert.equal(predict.parameters.autoTruncate,false);assert.equal(predict.instances[0].task_type,'RETRIEVAL_DOCUMENT');
  assert.match(h.calls[2].url,/:embedContent$/);assert(!h.calls[1].options.body.includes('PRIVATE KEY'));
});
test('Voyage native and existing direct URLs send its documented float, task, and truncation fields',async()=>{
  for(const cfg of [C.settings({embeddingProvider:'voyage',embeddingModel:'voyage-4-large'}),
    C.settings({embeddingProvider:'external',embeddingEndpoint:'https://api.voyageai.com/v1/embeddings',embeddingModel:'voyage-4-large'})]){
    const h=transport([{body:{data:[{index:0,embedding:[1,0]}]}},{body:{data:[{index:0,embedding:[0,1]}]}}]);
    assert.deepEqual(await P.embed(h.api,cfg,'VOYAGE_TEST_KEY',['사건 청크']),[[1,0]]);
    assert.deepEqual(await P.embed(h.api,cfg,'VOYAGE_TEST_KEY',['현재 질문'],'query'),[[0,1]]);
    for(const [i,kind] of ['document','query'].entries()){
      const {url,options}=h.calls[i],body=JSON.parse(options.body);
      assert.equal(url,'https://api.voyageai.com/v1/embeddings');assert.equal(options.headers.Authorization,'Bearer VOYAGE_TEST_KEY');
      assert.equal(body.model,'voyage-4-large');assert.equal(body.input_type,kind);assert.equal(body.output_dtype,'float');assert.equal(body.truncation,false);
      assert(!('encoding_format'in body));
    }
  }
});
test('Voyage model choices are explicitly a built-in text catalog and make no /models request',async()=>{
  const api={nativeFetch:async()=>{throw Error('Voyage catalog must not call an unverified models endpoint');}};
  for(const cfg of [C.settings({embeddingProvider:'voyage'}),C.settings({embeddingProvider:'external',embeddingEndpoint:'https://api.voyageai.com/v1'})]){
    const list=await P.embeddingModels(api,cfg,'');assert(list.some(m=>m.id==='voyage-4-large'));
    assert(!list.some(m=>/rerank|context|multimodal/.test(m.id)));
  }
});
test('Voyage detection accepts canonical bases but never matches lookalike hosts or credential URLs',async()=>{
  for(const url of ['https://api.voyageai.com/v1/embeddings','https://api.voyageai.com/v1/','https://api.voyageai.com'])assert(P.isVoyageURL(url));
  for(const url of ['https://api.voyageai.com.evil.invalid/v1/embeddings','https://voyageai.com/v1/embeddings','https://api.voyageai.com/v1/embeddings?key=secret','http://api.voyageai.com/v1/embeddings','https://key:secret@api.voyageai.com/v1/embeddings'])assert(!P.isVoyageURL(url));
  const h=transport([]);await assert.rejects(()=>P.embed(h.api,C.settings({embeddingProvider:'voyage',embeddingModel:'voyage-4-large'}),'',['data']),/Voyage AI 임베딩 API 키/);assert.equal(h.calls.length,0);
});
test('top-level detail/message validation errors are visible and still redact API credentials',async()=>{
  const cfg=C.settings({embeddingProvider:'voyage',embeddingModel:'voyage-4-large'});
  for(const body of [{detail:'encoding_format float is invalid: VOYAGE_TEST_KEY'},
    {detail:[{loc:['body','encoding_format'],msg:'invalid VOYAGE_TEST_KEY'}]},
    {message:'invalid encoding_format: VOYAGE_TEST_KEY'}]){
    const h=transport([{status:400,body}]);
    await assert.rejects(()=>P.embed(h.api,cfg,'VOYAGE_TEST_KEY',['문서']),e=>e.message.includes('400')&&e.message.includes('encoding_format')&&!e.message.includes('VOYAGE_TEST_KEY'));
  }
});
