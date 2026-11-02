// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,version=require('./package.json').version;
const header=`//@name RisuChronicleMemory
//@api 3.0
//@version ${version}
//@display-name Chronicle Memory · 사건 로그
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
// See README.md for installation and THIRD_PARTY_NOTICES.md for RPack attribution.
`;
fs.writeFileSync(path.join(root,`Chronicle_Memory_v${version}.js`),header+['core.cjs','providers.cjs','retrieval.cjs','storage.cjs','runtime.js'].map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n'));
const toggles=[
  'chronicle_ctl_group=📜 Chronicle Memory=group',
  'chronicle_ctl_intro=새 구간을 사건 기록 묶음(청크)으로 압축합니다. 단독·자체 하이브리드는 원문도 관리하고, Risu 기억 병행은 원문·과거 검색을 Risu에 맡깁니다. API·모델·지침은 플러그인에서 연결하세요.=caption',
  'chronicle_ctl_enabled=기억 사용=select=플러그인 기본값,모듈설정 사용,중지',
  'chronicle_ctl_enabled_help=플러그인 기본값: 아래 모듈 입력을 무시하고 플러그인 설정 전체를 따릅니다. 모듈설정 사용: 기억을 켜고 아래 값을 적용하며 빈칸만 플러그인 기본값을 따릅니다. 중지: 요약·주입·검색을 멈추고 저장 기억은 남깁니다.=caption',
  'chronicle_ctl_scope=Risu 토글은 기본적으로 공통 설정입니다. 이 대화만 바꾸려면 Risu의 로컬 토글 기능을 켜세요. 변경은 다음 요청부터 적용됩니다.=caption',
  'chronicle_ctl_interval=요약 주기 (5~20턴)=text',
  'chronicle_ctl_interval_help=완료된 AI 응답 1개를 1턴으로 셉니다. 사용자 입력 없이 별도 메시지로 진행한 응답도 각각 포함합니다. 첫 인사·미응답 입력·같은 메시지의 이어쓰기·재생성은 추가 턴이 아닙니다. 5로 정하면 새로 완료된 5턴만 다음 RP 요청 전에 요약합니다. 빈칸은 플러그인 기본값.=caption',
  'chronicle_ctl_recent=유지할 최근 원문 (5~20턴 · 단독·자체 하이브리드 전용)=text',
  'chronicle_ctl_recent_help=단독·자체 하이브리드에서 적용합니다. 요약 실패·미처리 구간은 추가로 남깁니다. Risu 기억 병행에서는 이 값을 무시하고 Risu가 전달한 원문과 내장 기억을 그대로 둡니다. 실제 저장 대화는 삭제하지 않습니다.=caption',
  'chronicle_ctl_chars=턴당 평균 요약 목표 (50~200글자 · 단독·자체 하이브리드)=text',
  'chronicle_ctl_chars_help=5턴 주기에 100글자면 청크 본문 약 500글자가 권장 목표입니다. 중요한 사실·추가 지침 때문에 길어져도 정상 요약은 저장하며 최근 원문 범위를 유지합니다. 턴마다 따로 자르지 않고 사건별로 묶습니다. 날짜·제목·검색 키워드는 본문 목표에서 제외하지만 출력 토큰은 함께 사용합니다.=caption',
  'chronicle_ctl_tokens=구간 응답 상한 (128~8192토큰)=text',
  'chronicle_ctl_tokens_help=한 묶음의 전체 요약 응답 예산입니다. 글자 수와 다른 단위이며 JSON 형식과 추론도 예산을 소비할 수 있습니다. 잘리면 늘려보세요. Risu 내부 모델 경로는 목표값이고 전역 출력 설정을 따릅니다.=caption',
  'chronicle_ctl_clean=요약 입력 정리=select=플러그인 기본값,사용,해제',
  'chronicle_ctl_clean_help=사용: 표시용 이미지·BGM 등 알려진 장식만 정리. 해제: 원문 그대로 요약. 구조화된 상태 JSON은 해석·차분 변환하지 않고 보존합니다. 실제 저장 원문과 분기 판정은 바꾸지 않습니다. 기본값 상속을 위해 체크박스 대신 3단계로 고릅니다.=caption',
  'chronicle_ctl_mode=원문 처리=select=플러그인 기본값,단독 (누적 로그 + 최근 원문),자체 하이브리드 (단독 + 청크 검색),Risu 기억 병행 (하이파 주력)',
  'chronicle_ctl_mode_help=단독·자체 하이브리드는 Risu 내장 기억을 끕니다. Risu 기억 병행은 하이파 등 내장 기억을 Risu에서 직접 켜고 원문·과거 검색을 맡깁니다. 연대기는 저장 원문에서 같은 주기로 압축하고 자체 검색·원문 자르기는 실행하지 않습니다.=caption',
  'chronicle_ctl_risu_chars=병행 전용 턴당 요약 목표 (10~200글자 · 기본 50)=text',
  'chronicle_ctl_risu_chars_help=Risu 기억 병행에서만 적용합니다. 5턴 × 50글자면 구간 본문 약 250글자. 짧은 사실구로 묶으며 추가 지침·중요 사실 때문에 길어져도 수용합니다. 기존 로그를 다시 압축하지 않고 새 구간부터 적용합니다.=caption',
  'chronicle_ctl_risu_scope=병행 연대기 주입=select=플러그인 기본값,누적 로그 전체,최근 K청크,기록만 (주입 안 함)',
  'chronicle_ctl_risu_chunks=병행 최근 청크 수 K (1~100 · 기본 2)=text',
  'chronicle_ctl_risu_scope_help=병행 기본값은 누적 로그 전체입니다. 최근 K청크·기록만은 주입 범위만 바꾸며 전체 저장 로그·백업은 유지합니다. K는 최근 K청크 선택 시에만 적용합니다. 하이파의 입력 토큰 예산은 Risu에서 별도로 설정하세요.=caption',
  'chronicle_ctl_limits=기본은 누적 로그 전체 주입이며 병행에서만 범위를 선택할 수 있습니다. 로그 글자 상한·대기 제한은 없습니다. 연대기는 내장 기억 처리 뒤에 추가되므로 전체 주입 시 Risu에서 컨텍스트 여유를 확보하세요. 병행은 Risu가 이미 제외한 원문을 복원하지 않습니다.=caption',
  'chronicle_ctl_batches=요청당 최대 묶음 (1~20)=text',
  'chronicle_ctl_batches_help=오래된 대화를 처음 적용할 때 한 번에 따라잡을 요약 묶음 수입니다. 늘리면 추가 호출과 대기 시간이 늘어납니다.=caption',
  'chronicle_ctl_cache=요약과 수동 수정은 채팅별로 저장되어 돌아오면 자동으로 읽습니다. 분기는 공통 원문 구간만 재사용합니다. JSON은 별도 백업용입니다.=caption',
  'chronicle_ctl_delete=저장 기록 확인·삭제: Risu 설정 → Chronicle Memory → 저장된 기억 · 캐시 관리. 캐시는 대화를 이동해도 남습니다. 입력칸을 비우거나 잘못된 값을 넣으면 해당 플러그인 기본값을 사용합니다. 잘못된 값은 플러그인에 경고를 표시합니다.=caption',
  'chronicle_ctl_end==groupEnd'
].join('\n');
const moduleData={name:`Chronicle Control v${version}`,description:'Risu 기본 설정창에서 Chronicle 주기·상한을 조절합니다. Copyright (C) 2026 HyunnJg. GPL-3.0-only; 무보증. LICENSE 및 THIRD_PARTY_NOTICES.md 참조.',
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
