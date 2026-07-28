# Upload Security Plan

## 현재 MVP 방침

- 한전 자동 로그인, 크롤링, 비공식 API 호출을 하지 않는다.
- 사용자가 직접 내려받은 한전 고지서 PDF와 파워플래너 엑셀/CSV만 업로드한다.
- 파일은 서버로 전송하지 않고 브라우저 로컬에서만 파싱한다.
- 시연용 데이터는 localStorage 24시간 TTL로 만료 처리한다.
- 지원 형식은 텍스트형 한전 고지서 `.pdf`, `.xlsx`, `.csv`, 파워플래너 HTML 내보내기 `.xls`이다. 일반 바이너리 `.xls`는 지원하지 않으며 XLSX 또는 CSV로 다시 저장하도록 안내한다.
- PDF.js는 브라우저에서만 지연 로드하고 PDF 렌더링이나 문서 동작 실행 없이 텍스트만 추출한다. 파일당 10MB, 선택당 36개·50MB, 전체 72쪽·추출 문자열 500,000자로 제한하며 `%PDF-` 헤더를 확인한다.
- 스캔 이미지형·암호화 PDF에는 앱 내부 OCR을 실행하지 않는다. 무료 AI 변환 도우미를 사용할 때는 고객번호, 주소, 담당자 연락처, 계좌·납부정보를 먼저 삭제하라는 외부 서비스 경고를 표시한다.
- 업로드 파일은 압축 원본 10MB, 파싱된 실제 전체 행 10,000행, 시트당 256열로 제한한다.
- XLSX는 중앙 디렉터리와 각 로컬 헤더를 먼저 확인하고, pako가 작은 청크로 실제 해제한 출력 바이트를 합산하며 CRC32도 누적 검증한다. 내부 항목 200개 또는 실제 해제 출력 50MB를 넘거나 CRC가 일치하지 않으면 ExcelJS 로드 전에 중단하며, 해제 데이터를 보관하지 않는다.

## 현재 파서 경계

일반 `.xlsx`는 ExcelJS로 읽고, CSV와 파워플래너 HTML `.xls`는 별도 로컬 파서로 읽는다. XLSX 사전 검사는 ZIP64 sentinel, 암호화, 지원하지 않는 압축 방식, 중앙 디렉터리와 로컬 헤더 불일치, 실제 해제 출력 CRC32 불일치를 거부한다. CFBF(`D0 CF 11 E0`) 매직 바이트를 가진 구형 바이너리 XLS는 확장자와 관계없이 거부한다. 손상됐거나 ZIP 형식이 아닌 XLSX도 원시 라이브러리 오류를 노출하지 않고 XLSX/CSV 변환 안내로 처리한다. ExcelJS는 업로드된 수식, 외부 링크, 매크로를 실행하지 않는다. 수식 셀은 파일에 저장된 표시 결과만 사용하며 결과가 없으면 빈 값으로 처리한다. 업로드 텍스트는 HTML로 삽입하지 않는다.

## 운영 전 보완 계획

1. 일반 `.xlsx` 파싱은 Web Worker 또는 sandboxed iframe으로 분리한다.
2. 셀 문자열 길이와 시트 이름 길이 제한을 추가한다.
3. 운영 환경에서는 대체 파서 또는 서버 격리 파서를 검토한다.
4. 원본 파일, 고객번호, 담당자 연락처, 실제 학교명은 로그와 분석 리포트에 저장하지 않는다.
5. 업로드 실패 원인은 사용자 안내로만 표시하고 원본 파일 내용은 외부 전송하지 않는다.

## 검증 기준

- 필수 컬럼 누락 시 오류가 아니라 수동 매핑 안내를 보여준다.
- CSV 한글 헤더는 UTF-8 기준으로 보존하고, 깨짐 감지 시 `euc-kr` 디코딩을 시도한다.
- 구형 바이너리 `.xls`는 명확한 변환 안내와 함께 거부하고, 파워플래너 HTML `.xls`는 로컬 파서로 계속 인식한다.
- 자동화 테스트에서 합성 `.xlsx` fixture, 파워플래너 HTML `.xls`, CSV, CFBF 위장 파일, 손상 XLSX, ZIP64/중앙 디렉터리 손상, 위조된 메타데이터의 실제 deflate 출력, 행/열/파일 크기 제한을 검증한다.

## 의존성 감사 상태

`npm ls xlsx`에서 취약한 `xlsx` 패키지가 없는 것을 확인했다. 초기 `npm audit --omit=dev` 재시도는 npm 10.9.8의 retired quick endpoint에서 HTTP 400 `Invalid package tree`를 반환했지만, 2026-07-26 후속 전체 감사는 정상 완료됐다. 보정 전 운영 의존성 결과는 high 10, moderate 1, low 1, 총 12건이었다. `npm audit fix --omit=dev`를 `--force` 없이 실행해 DOMPurify 3.4.12, PostCSS 8.5.23, Nanoid 3.3.16으로 lockfile을 갱신했고 ExcelJS 4.4.0은 유지했다. 재감사 결과는 high 9, moderate 1, low 0, 총 10건이다. 남은 항목은 ExcelJS의 Node용 stream/archive 경로가 가져오는 `archiver`, `archiver-utils`, `zip-stream`, `readdir-glob`, `glob`, `minimatch`, `brace-expansion`, `rimraf`, `uuid` 체인이다. 이 MVP의 브라우저 번들은 ExcelJS browser build와 `Workbook.xlsx.load`만 사용하며 Node stream reader/writer API를 호출하지 않지만, 이는 깨끗한 감사 또는 운영 위험 부재를 뜻하지 않는다. ExcelJS를 강제로 3.x로 내리는 변경은 적용하지 않았으며 실제 운영 전에는 대체 또는 격리 파서를 재검토해야 한다.
