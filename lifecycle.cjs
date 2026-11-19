// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const ChronicleLifecycle = (() => {
  'use strict';
  function create(api,handler,{onChange=()=>{},now=()=>new Date().toISOString(),safeError=error=>String(error?.message||error)}={}) {
    let phase='idle',detail='',lastHookAt='',pending=null,candidate=null,disposed=false;
    const snapshot=()=>({phase,detail,lastHookAt});
    const emit=()=>{try{onChange(snapshot());}catch{/* Diagnostics cannot block registration or RP. */}};
    const change=(next,message='')=>{if(disposed)return;phase=next;detail=message;emit();};
    async function checkPermission() {
      if(typeof api.requestPluginPermission!=='function')return undefined;
      // Check AFTER addRisuReplacer: preflight checks can bypass Risu's periodic reconfirmation.
      const granted=await api.requestPluginPermission('replacer');
      return typeof granted==='boolean'?granted:undefined;
    }
    function ensure() {
      if(disposed||phase==='confirmed')return Promise.resolve(snapshot());
      if(pending)return pending;
      const checking=phase==='unverified'&&candidate;
      change('pending',checking?'등록 후 권한 상태를 확인하고 있습니다.':'Risu 권한창의 응답을 기다리고 있습니다.');
      pending=Promise.resolve().then(async()=>{
        try {
          if(disposed)return snapshot();
          if(!checking) {
            if(candidate) {
              candidate.active=false;
              if(typeof api.removeRisuReplacer==='function')await api.removeRisuReplacer('beforeRequest',candidate.fn);
            }
            if(disposed)return snapshot();
            const attempt={active:true,fn:null};
            attempt.fn=async(messages,type)=>{
              if(disposed||!attempt.active)return messages;
              if(type==='model'&&!messages.some(m=>m.memo==='risu-chronicle-summary-v1')){
                lastHookAt=now();change('confirmed','실제 RP 요청에서 기억 처리 훅 실행을 확인했습니다.');
              }
              return handler(messages,type);
            };
            candidate=attempt;
            const result=await api.addRisuReplacer('beforeRequest',attempt.fn);
            if(disposed){
              attempt.active=false;
              if(typeof api.removeRisuReplacer==='function')try{await api.removeRisuReplacer('beforeRequest',attempt.fn);}catch{}
              return snapshot();
            }
            if(result===false){attempt.active=false;change('denied');return snapshot();}
          }
          if(disposed)return snapshot();
          const granted=await checkPermission();
          if(disposed)return snapshot();
          if(granted===false){candidate.active=false;change('denied');}
          else if(granted===true||lastHookAt)change('confirmed',lastHookAt?'실제 RP 요청에서 기억 처리 훅 실행을 확인했습니다.':'Risu 등록 호출과 권한 승인을 확인했습니다.');
          else change('unverified','등록 호출은 끝났지만 이 Risu 환경에서 승인 결과를 확인할 수 없습니다. 다음 RP 요청에서 실제 실행 여부를 확인합니다.');
        } catch(error) {
          change('error',safeError(error));
        }
        return snapshot();
      }).finally(()=>{pending=null;});
      return pending;
    }
    async function dispose() {
      if(disposed)return;
      disposed=true;phase='unloaded';if(candidate)candidate.active=false;emit();
      if(candidate&&typeof api.removeRisuReplacer==='function'){
        try{await api.removeRisuReplacer('beforeRequest',candidate.fn);}catch{}
      }
    }
    return {snapshot,ensure,dispose};
  }
  function describe(state) {
    const labels={idle:'주입 훅 등록 전',pending:'주입 권한 응답 대기 중',confirmed:state.lastHookAt?'주입 훅 실행 확인':'주입 권한 승인·등록 확인',unverified:'주입 훅 등록 결과 확인 필요',denied:'주입 권한 미승인',error:'주입 훅 등록 오류',unloaded:'플러그인 종료됨'};
    const help=state.phase==='pending'?'창이 사라져도 승인된 것으로 처리하지 않습니다. 자동으로 중복 요청하지 않으며, 계속 대기 중이면 Risu를 완전히 종료한 뒤 다시 실행해 확인하세요.':state.phase==='denied'?'자동 요약·주입이 연결되지 않았습니다. 창을 닫거나 다른 알림이 덮어쓴 경우도 포함할 수 있습니다. 권한 확인·등록을 시도하되, 세션의 거절 캐시 때문에 창이 다시 뜨지 않으면 Risu를 완전히 종료한 뒤 다시 실행하세요.':'';
    return [labels[state.phase]||labels.unverified,state.detail,help,state.lastHookAt?`이번 실행의 마지막 RP 훅: ${new Date(state.lastHookAt).toLocaleString()}`:'이번 실행에서 RP 훅 실행은 아직 확인하지 못했습니다.'].filter(Boolean).join('\n');
  }
  return {create,describe};
})();
if(typeof module!=='undefined')module.exports=ChronicleLifecycle;
