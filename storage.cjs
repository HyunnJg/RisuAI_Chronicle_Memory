// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
/* Derived retrieval data is separate from durable narrative state. */
const ChronicleStorage=(()=>{
  function create(storage,ns,{validVector,entryHash}){
    const chats=ns+'chat:',vectorPrefix=ns+'vectors:',recallPrefix=ns+'recall:';
    const vectorCache=new Map(),queries=new Map();
    function key(prefix,chat){if(!chat.startsWith(chats))throw Error('잘못된 기억 저장소 키');return prefix+chat.slice(chats.length);}
    function keep(map,k,v){map.delete(k);map.set(k,v);while(map.size>4)map.delete(map.keys().next().value);return v;}
    async function read(k,fallback){try{const value=await storage.getItem(k);return value==null?fallback:typeof value==='string'?JSON.parse(value):value;}catch{return fallback;}}
    async function vectors(chat){
      if(vectorCache.has(chat))return vectorCache.get(chat);
      const data=await read(key(vectorPrefix,chat),null);
      const entries=data?.schema===1&&data.entries&&typeof data.entries==='object'&&!Array.isArray(data.entries)?data.entries:{};
      return keep(vectorCache,chat,{schema:1,entries:Object.assign(Object.create(null),entries)});
    }
    async function saveVectors(chat,value){await storage.setItem(key(vectorPrefix,chat),JSON.stringify(value));keep(vectorCache,chat,value);}
    async function recall(chat){const value=await read(key(recallPrefix,chat),null);return value&&Array.isArray(value.selected)&&typeof value.text==='string'?value:null;}
    async function saveRecall(chat,value){
      const old=await recall(chat),withoutTime=v=>v&&Object.fromEntries(Object.entries(v).filter(([k])=>k!=='at'));
      if(JSON.stringify(withoutTime(old))!==JSON.stringify(withoutTime(value)))await storage.setItem(key(recallPrefix,chat),JSON.stringify(value));
    }
    async function clearRecall(chat){queries.delete(chat);await storage.removeItem(key(recallPrefix,chat));}
    async function sync(chat,state){
      const index=await vectors(chat),active=new Set(state.entries.map(e=>e.id));let dirty=false;
      for(const id of Object.keys(index.entries))if(!active.has(id)){delete index.entries[id];dirty=true;}
      for(const entry of state.entries){
        const saved=index.entries[entry.id],candidate=entry.embedding||saved;
        if(candidate&&(!validVector(candidate.vector)||candidate.hash!==await entryHash(entry))){
          if(saved){delete index.entries[entry.id];dirty=true;}
        }else if(candidate&&candidate!==saved&&(candidate.hash!==saved?.hash||candidate.signature!==saved?.signature)){
          index.entries[entry.id]=candidate;dirty=true;
        }
      }
      if(dirty){await saveVectors(chat,index);await clearRecall(chat);}
      if(state.queryEmbedding)keep(queries,chat,state.queryEmbedding);
      if(state.lastRecall)await saveRecall(chat,state.lastRecall);
    }
    async function copy(from,to,entries){
      const source=await vectors(from),target=await vectors(to);let changed=false;
      for(const entry of entries){const value=source.entries[entry.id];if(value&&validVector(value.vector)&&value.hash===await entryHash(entry)){target.entries[entry.id]=value;changed=true;}}
      if(changed)await saveVectors(to,target);
    }
    async function reset(chat){vectorCache.delete(chat);queries.delete(chat);await storage.removeItem(key(vectorPrefix,chat));await storage.removeItem(key(recallPrefix,chat));}
    async function derivedChats(){const keys=await storage.keys();return [...new Set(keys.flatMap(k=>k.startsWith(vectorPrefix)?[chats+k.slice(vectorPrefix.length)]:k.startsWith(recallPrefix)?[chats+k.slice(recallPrefix.length)]:[]))];}
    return {vectors,saveVectors,recall,saveRecall,clearRecall,sync,copy,reset,derivedChats,
      query:chat=>queries.get(chat),saveQuery:(chat,value)=>keep(queries,chat,value),clearQuery:chat=>queries.delete(chat)};
  }
  return {create};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ChronicleStorage;
