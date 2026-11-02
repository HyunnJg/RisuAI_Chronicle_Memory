// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const ChroniclePlatform = (() => {
  'use strict';
  function probe(env=globalThis) {
    return {secure:typeof env.isSecureContext==='boolean'?env.isSecureContext:null,
      digest:typeof env.crypto?.subtle?.digest==='function',uuid:typeof env.crypto?.randomUUID==='function',
      fileRead:typeof env.File?.prototype?.text==='function'||typeof env.FileReader==='function',
      fileDownload:typeof env.Blob==='function'&&typeof env.URL?.createObjectURL==='function'};
  }
  function memoryError(env=globalThis) {
    const p=probe(env),missing=[!p.digest?'SHA-256 원문 검증':'',!p.uuid?'기록 ID 생성':''].filter(Boolean);
    return missing.length?`${missing.join(' · ')} 기능을 사용할 수 없습니다. HTTPS 주소 또는 PC의 localhost 환경과 최신 브라우저를 확인하세요. 기억 처리는 건너뛰며 RP 원문은 유지합니다.`:'';
  }
  function assertMemory(env=globalThis) {
    const message=memoryError(env);if(message){const e=Error(message);e.code='CHRONICLE_ENVIRONMENT';throw e;}
  }
  function description(env=globalThis) {
    const p=probe(env);
    return [`접속 환경: ${p.secure===true?'보안 컨텍스트':p.secure===false?'일반 HTTP 등 비보안 컨텍스트':'호스트에서 구분 정보 미제공'}`,
      `원문 검증 ${p.digest?'사용 가능':'사용 불가'} · 기록 ID ${p.uuid?'사용 가능':'사용 불가'}`,
      `JSON 파일 읽기 ${p.fileRead?'사용 가능':'지원 확인 필요'} · 파일 다운로드 ${p.fileDownload?'사용 가능':'JSON 직접 복사 사용'}`,
      '기능 유무를 확인한 결과이며 웹·PocketRisu·Android·iOS 실기 호환을 보장하지 않습니다.'].join('\n');
  }
  async function readFile(file,env=globalThis) {
    if(typeof file?.text==='function')return file.text();
    if(typeof env.FileReader!=='function')throw Error('이 환경에서는 JSON 파일을 읽을 수 없습니다. 최신 브라우저에서 다시 시도하세요.');
    return new Promise((resolve,reject)=>{
      const reader=new env.FileReader();
      reader.onload=()=>resolve(String(reader.result??''));
      reader.onerror=()=>reject(Error('JSON 파일 읽기에 실패했습니다. 파일을 다시 선택하세요.'));
      reader.onabort=()=>reject(Error('JSON 파일 읽기가 취소되었습니다.'));
      reader.readAsText(file,'UTF-8');
    });
  }
  function backup(value,env=globalThis) {
    const text=JSON.stringify(value,null,2);let url='';
    try{if(probe(env).fileDownload)url=env.URL.createObjectURL(new env.Blob([text],{type:'application/json;charset=utf-8'}));}catch{}
    return {text,url};
  }
  function releaseBackup(prepared,env=globalThis) {
    if(prepared?.url&&typeof env.URL?.revokeObjectURL==='function')try{env.URL.revokeObjectURL(prepared.url);}catch{}
  }
  return {probe,memoryError,assertMemory,description,readFile,backup,releaseBackup};
})();
if(typeof module!=='undefined')module.exports=ChroniclePlatform;
