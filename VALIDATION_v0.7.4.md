# v0.7.4 검증 범위

## 변경

플러그인 상단의 저작권·라이선스 배너와 Control 모듈 소개의 해당 문구만 제거했습니다. 기능 설명을 보완하고 표시 버전을 갱신했습니다. 기억 처리·API 요청·환경 대응·저장 형식은 v0.7.3과 같습니다. 제미니 검토의 기능 제안은 이번 패치에 포함하지 않았습니다.

## 확인

- 빌드 후 기존 자동 테스트 121개 통과.
- 설치용 JS를 JSDOM에서 열어 헤더에 제품명·버전·기능 설명이 있고 저작권·라이선스 배너가 없는지 확인.
- .module.json·.risum·.charx의 모듈 소개가 같은 기능 설명을 사용하는지 확인.
- 배포 ZIP의 LICENSE·THIRD_PARTY_NOTICES.md·RPACK_LICENSE.txt·RPACK_UPSTREAM_LICENSE.txt 및 소스 주석을 보존.

## 제한

실제 Risu 웹·PocketRisu·Android·iOS·제공자 API 호출을 새로 검증하지 않았습니다. 기존 웹·모바일 안전장치의 검증 범위는 VALIDATION_v0.7.3.md와 같습니다.
