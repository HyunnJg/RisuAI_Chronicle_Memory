// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,version=require('./package.json').version;
const header=`//@name RisuChronicleMemory
//@api 3.0
//@version ${version}
//@update-url https://raw.githubusercontent.com/HyunnJg/RisuAI_Chronicle_Memory/main/Chronicle_Memory.js
//@link https://github.com/HyunnJg/RisuAI_Chronicle_Memory GitHub
//@display-name Chronicle Memory · 사건 로그
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
// See README.md for installation and THIRD_PARTY_NOTICES.md for RPack attribution.
`;
// Bundle the pinned engine directly: Risu's sandbox CSP disallows blob workers and
// remote script loading. No native fallback executes user-supplied regex patterns.
const engine='/*\n'+fs.readFileSync(path.join(root,'vendor/RE2JS_LICENSE.txt'),'utf8')+'\n*/\n'+
  'const ChronicleRegexEngine=(()=>{const exports={};const module={exports};\n'+fs.readFileSync(path.join(root,'vendor/re2js.js'),'utf8')+'\nreturn module.exports.RE2JS;})();\n';
const plugin=header+engine+['core.cjs','providers.cjs','retrieval.cjs','storage.cjs','platform.cjs','lifecycle.cjs','runtime.js'].map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
fs.writeFileSync(path.join(root,`Chronicle_Memory_v${version}.js`),plugin);
fs.writeFileSync(path.join(root,'Chronicle_Memory.js'),plugin);
const toggles=[
  'chronicle_ctl_group=📜 Chronicle Memory=group',
  'chronicle_ctl_intro=대화를 사건 기록으로 남기는 장기기억입니다. 모델 연결은 플러그인 설정에서 지정하세요.=caption',
  'chronicle_ctl_enabled=기억 사용=select=플러그인 기본값,모듈설정 사용,중지',
  'chronicle_ctl_enabled_help=기본값을 따르거나, 아래 모듈 설정을 적용합니다. 중지해도 저장된 기억은 남습니다.=caption',
  'chronicle_ctl_scope=이 대화에만 적용하려면 Risu의 로컬 토글을 켜세요.=caption',
  'chronicle_ctl_interval=요약 주기 (5~20턴)=text',
  'chronicle_ctl_interval_help=완료된 AI 응답을 기준으로 새 구간을 묶어 요약합니다.=caption',
  'chronicle_ctl_recent=유지할 최근 원문 (5~20턴 · 단독·자체 하이브리드 전용)=text',
  'chronicle_ctl_recent_help=최근 대화를 원문으로 남깁니다. 미처리 구간은 추가로 보존하며, 병행 모드에서는 Risu가 관리합니다.=caption',
  'chronicle_ctl_trim=원문 자르기 방식 (단독·자체 하이브리드)=select=플러그인 기본값,매 턴 이동,청크 커밋 시 이동 (계단식)',
  'chronicle_ctl_trim_help=매 턴 이동은 최근 원문 범위를 매번 갱신하고, 계단식은 새 청크를 저장할 때 갱신합니다.=caption',
  'chronicle_ctl_chars=턴당 평균 요약 목표 (50~200글자 · 단독·자체 하이브리드)=text',
  'chronicle_ctl_chars_help=턴당 요약 분량의 권장 목표입니다. 중요한 기록은 목표를 넘어도 보존합니다.=caption',
  'chronicle_ctl_tokens=구간 응답 상한 (128~8192토큰)=text',
  'chronicle_ctl_tokens_help=구간 요약의 응답 예산입니다. 응답이 잘리면 늘리세요. 내부 모델은 Risu 출력 설정을 따릅니다.=caption',
  'chronicle_ctl_clean=요약 입력 정리=select=플러그인 기본값,사용,해제',
  'chronicle_ctl_clean_help=이미지·BGM 등 장식을 정리하고 이름을 치환합니다. 저장 원문은 유지합니다.=caption',
  'chronicle_ctl_mode=원문 처리=select=플러그인 기본값,단독 (누적 로그 + 최근 원문),자체 하이브리드 (단독 + 청크 검색),Risu 기억 병행 (하이파 주력)',
  'chronicle_ctl_mode_help=단독·하이브리드는 Risu 내장 기억을 끄세요. 병행 모드는 내장 기억을 직접 켜고 함께 사용합니다.=caption',
  'chronicle_ctl_risu_chars=병행 전용 턴당 요약 목표 (10~200글자 · 기본 50)=text',
  'chronicle_ctl_risu_chars_help=Risu 기억 병행에서 새로 만드는 연대기의 요약 분량입니다.=caption',
  'chronicle_ctl_risu_scope=병행 연대기 주입=select=플러그인 기본값,누적 로그 전체,최근 K청크,기록만 (주입 안 함)',
  'chronicle_ctl_risu_chunks=병행 최근 청크 수 K (1~100 · 기본 2)=text',
  'chronicle_ctl_risu_scope_help=매번 전달할 연대기 범위입니다. 전체 기록은 계속 저장합니다.=caption',
  'chronicle_ctl_limits=누적 로그 전체를 보내면 대화가 길어질수록 입력 분량도 늘어납니다.=caption',
  'chronicle_ctl_hybrid_scope=하이브리드 누적 로그 주입 (자체 하이브리드 전용)=select=플러그인 기본값,누적 로그 전체,최근 K청크 (오래된 청크는 검색으로만)',
  'chronicle_ctl_hybrid_chunks=하이브리드 최근 청크 수 K (1~100 · 기본 10)=text',
  'chronicle_ctl_hybrid_scope_help=최근 K청크는 항상 보내고, 오래된 기록은 관련성이 있을 때 검색합니다. 일부 기록은 검색에서 빠질 수 있습니다.=caption',
  'chronicle_ctl_blocking=요약 대기 방식=select=플러그인 기본값,기다림 (요약 후 RP 전송),기다리지 않음 (요약은 뒤에서 진행)',
  'chronicle_ctl_blocking_help=기다리지 않으면 RP를 바로 보내고 새 기억은 요약 완료 후 다음 요청부터 반영합니다. 대기 중에는 미요약 원문을 유지합니다.=caption',
  'chronicle_ctl_batches=요청당 최대 묶음 (1~20)=text',
  'chronicle_ctl_batches_help=오래된 대화를 따라잡을 때 한 번에 처리할 최대 구간 수입니다.=caption',
  'chronicle_ctl_cache=기억은 채팅별로 자동 저장됩니다. JSON은 별도 백업용입니다.=caption',
  'chronicle_ctl_delete=저장 기록 관리는 플러그인 설정에서 합니다. 빈칸은 플러그인 기본값을 따릅니다.=caption',
  'chronicle_ctl_end==groupEnd'
].join('\n');
const moduleData={name:`Chronicle Control v${version}`,description:'Risu 기본 설정창에서 Chronicle 요약 주기·원문 처리·주입 범위를 조절합니다. API·모델·추가 지침은 플러그인에서 설정합니다.',
  id:'chronicle-control-49f59491-2825-4624-ad22-53395a714fa8',namespace:'chronicle-control',lowLevelAccess:false,lorebook:[],assets:[],regex:[],
  customModuleToggle:toggles,trigger:[{comment:'Chronicle native settings sync',type:'start',conditions:[],effect:[{type:'triggerlua',code:fs.readFileSync(path.join(root,'Chronicle_Control.lua'),'utf8')}]}]};
fs.writeFileSync(path.join(root,`Chronicle_Control_v${version}.module.json`),JSON.stringify(moduleData,null,2));
const data=Buffer.from(JSON.stringify({module:moduleData,type:'risuModule'}),'utf8');
const map=fs.readFileSync(path.join(root,'rpack_map.bin'));if(map.length!==512)throw Error('Invalid RPack map');
const encoded=Buffer.from(data.map(b=>map[b]));const length=Buffer.alloc(4);length.writeUInt32LE(encoded.length);
const risum=Buffer.concat([Buffer.from([111,0]),length,encoded,Buffer.from([0])]);
fs.writeFileSync(path.join(root,`Chronicle_Control_v${version}.risum`),risum);
// Standard ZIP store writer; no external build dependencies.
function crc32(buf){let value=0xffffffff;for(const b of buf){value^=b;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function zip(files){
  let offset=0;const local=[],central=[];
  for(const [name,content] of files){
    const filename=Buffer.from(name),bytes=Buffer.isBuffer(content)?content:Buffer.from(content),crc=crc32(bytes);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
    local.push(h,filename,bytes);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    central.push(c,filename);offset+=h.length+filename.length+bytes.length;
  }
  const centralData=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralData.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,centralData,end]);
}
const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:moduleData.name,description:'',personality:'',scenario:'',first_mes:'',mes_example:'',creator_notes:moduleData.description,
  system_prompt:'',post_history_instructions:'',alternate_greetings:[],character_book:{entries:[]},tags:[],creator:'',character_version:version,group_only_greetings:[],nickname:'',source:[],assets:[],
  extensions:{risuai:{lowLevelAccess:false,toggles,defaultVariables:'',hideChatIcon:false},moduleNoneImage:true}}};
fs.writeFileSync(path.join(root,`Chronicle_Control_v${version}.charx`),zip([['card.json',JSON.stringify(card,null,2)],['module.risum',risum]]));
console.log(`Built v${version} plugin and native settings modules (.charx / .risum).`);
