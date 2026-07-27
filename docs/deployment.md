# Deployment

이 MVP의 현재 운영 경로는 NAS 정적 사이트를 Cloudflare로 공개하는 구성이고, 운영 도메인은 [https://el-bill.h19h19.com/](https://el-bill.h19h19.com/)이다. 이 NAS+Cloudflare 경로만 이 repo의 현재 운영 배포와 롤백 절차에 해당한다. 배포 비밀값, NAS 접속 정보, Cloudflare API 토큰은 repo에 저장하지 않는다.

## 배포 전 필수 검증

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
npm audit --omit=dev
```

`npm run build`는 Vite 빌드 뒤 `npm run verify:bundle`을 자동 실행한다. 이 검사는 `dist/assets/index-*.js`의 가장 큰 초기 `index` 청크가 700,000 bytes를 넘으면 실패한다. 문서 PDF 라이브러리와 대시보드·요금제 비교·피크·문서 생성 화면은 지연 로드되어 초기 진입 청크에 포함되지 않아야 한다. 지연 청크 로딩 자체가 실패하면 앱 셸과 사이드바는 유지하고, 뷰 영역에서 한국어 복구 패널과 페이지 새로고침 버튼을 제공해야 한다.

`npm audit --omit=dev` 결과에 ExcelJS의 Node 전용 파일 처리 경로에만 도달하는 전이 취약점이 남으면 건수와 경로를 기록한다. 현재 앱의 ExcelJS 사용은 브라우저에서 사용자가 직접 선택한 파일을 읽는 경로이므로, Node 서버 파일 시스템이나 서버 압축 해제 입력에는 연결되지 않는다. 이 도달성 판단은 취약점 자체를 0건으로 간주하거나 결과 기록을 생략하는 근거가 아니다.

## 운영 배포와 롤백

1. 검증된 커밋에서 `npm ci`와 전체 로컬 게이트를 통과한 뒤 `npm run build`를 실행한다.
2. NAS의 현재 정적 사이트 디렉터리를 타임스탬프가 붙은 백업 디렉터리로 보관한다. 새 `dist`는 임시 경로에 올린 뒤, 업로드가 완전한지 확인하고 정적 사이트 경로로 원자적으로 교체한다.
3. Cloudflare 뒤의 공개 URL에서 아래 운영 스모크를 완료한다. 해시된 정적 자산은 새 파일명을 사용하므로, 정상 캐시 정책에서는 전역 캐시 삭제가 필수는 아니다. 오래된 HTML이 계속 보일 때만 운영자가 제한된 범위의 캐시 무효화를 검토한다.
4. 실패하면 새 사이트 디렉터리를 제거하고 직전 타임스탬프 백업을 원래 정적 사이트 경로로 되돌린다. 롤백 후 공개 URL의 첫 화면과 콘솔 오류를 다시 확인한다.

NAS 또는 Cloudflare를 변경하기 전에는 대상 경로, 현재 백업, 공개 도메인을 운영 담당자가 다시 확인해야 한다. 이 문서는 배포 명령을 자동 실행하지 않는다.

## 운영 스모크: 부모 배포 대기

이 저장소 상태에서는 운영 배포와 공개 URL 스모크를 실행하지 않았다. 부모 배포가 NAS+Cloudflare에 완료된 뒤 [https://el-bill.h19h19.com/](https://el-bill.h19h19.com/)에서 체크인된 합성 XLSX와 파워플래너 CSV를 사용해 다음을 확인한다. 먼저 검증한 로컬 `dist`의 해시 엔트리와 공개 HTML의 엔트리가 같은지 확인하고, 공개 HTML 및 엔트리 응답과 캐시 헤더를 검사한 다음 Playwright 스모크를 실행한다. `PLAYWRIGHT_BASE_URL`을 지정하면 Playwright는 로컬 빌드·미리보기 서버를 시작하지 않고 지정한 URL만 검사한다.

```bash
set -euo pipefail

PUBLIC_URL=https://el-bill.h19h19.com/
PUBLIC_HTML=/tmp/el-bill-index.html
HTML_HEADERS=/tmp/el-bill-index.headers
ENTRY_HEADERS=/tmp/el-bill-entry.headers

HTML_STATUS=$(curl -sS -D "$HTML_HEADERS" -o "$PUBLIC_HTML" -w '%{http_code}' "$PUBLIC_URL")
test "$HTML_STATUS" = 200

BUILT_ENTRY="/assets/$(basename "$(find dist/assets -maxdepth 1 -type f -name 'index-*.js' -print -quit)")"
PUBLIC_ENTRY=$(sed -nE 's/.*src="([^"]*\/assets\/index-[^"]+\.js)".*/\1/p' "$PUBLIC_HTML" | head -n 1)
test -n "$PUBLIC_ENTRY"
test "$PUBLIC_ENTRY" = "$BUILT_ENTRY"

ENTRY_STATUS=$(curl -sS -D "$ENTRY_HEADERS" -o /dev/null -w '%{http_code}' "${PUBLIC_URL%/}${PUBLIC_ENTRY}")
test "$ENTRY_STATUS" = 200

tr -d '\r' < "$HTML_HEADERS" | grep -Eiq '^cache-control:.*no-store'
tr -d '\r' < "$HTML_HEADERS" | grep -Eiq '^cf-cache-status:[[:space:]]*DYNAMIC[[:space:]]*$'

printf 'HTML %s, entry %s: %s\n' "$HTML_STATUS" "$ENTRY_STATUS" "$PUBLIC_ENTRY"
PLAYWRIGHT_BASE_URL=https://el-bill.h19h19.com/ npx playwright test --project=chromium -g "pasted bill|manual bill|usage guide|mobile personal input"
```

1. 고지서 XLSX가 연속 12개월로 인식되고 자동진단이 사용자 고지서 상태로 전환된다.
2. 파워플래너 파일만 올리면 고지서는 시연 샘플 상태를 유지하고 변경신청 ZIP은 비활성화된다.
3. 업로드 자료가 추천 결과와 피크관리 차트 및 입력값에 반영된다.
4. 사용자 표시명으로 생성된 ZIP에 PDF 3종이 포함되고 각 PDF가 `%PDF` 헤더와 정상 크기를 가진다.
5. 390x844 모바일에서 메뉴, TOP 3 표의 가로 스크롤, 문서 미리보기 가로 스크롤이 동작한다.
6. 페이지 및 콘솔 오류는 0건이어야 한다. Cloudflare Analytics/Telemetry 같은 외부 관측 요청 실패는 앱 오류와 분리해 기록한다.
7. 업로드 직후 새로고침해도 `el-bill:storage-active`가 가리키는 `el-bill:storage-snapshot:<sessionId>`에서 고지서·프로필·피크·요금표·파워플래너·출처와 `revision`이 함께 복원된다. 구버전 고정 루트 또는 개별 키가 있는 브라우저에서는 가장 이른 만료 시각을 유지한 채 세션 스냅샷을 먼저 저장하고 포인터를 마지막에 전환하며, 성공 후에만 구버전 키가 제거된다.
8. Web Locks API를 지원하는 브라우저의 두 탭에서 `navigator.locks` 존재를 확인한다. A 탭이 `el-bill:storage-mutation` 락을 점유한 상태에서 B 탭 편집을 실행하면 요청이 pending이고 `revision`이 바뀌지 않아야 하며, A 탭이 락을 해제한 뒤에만 두 변경이 병합되고 `revision`이 증가해야 한다. 같은 필드는 락 실행 순서의 마지막 변경이 남아야 한다.
9. 두 탭을 연 상태에서 한 탭이 새 파일을 올리면 다른 탭이 포인터 승자의 스냅샷을 통째로 채택한다. 포인터 전환 뒤 이전 활성 스냅샷은 즉시 제거되어 반복 업로드 후에는 현재 승자 키만 남아야 한다. 이전 키 삭제가 실패해도 새 승자는 유지되어야 하며, 오래된 탭의 일반 편집·초기화·만료 정리가 새 업로드의 포인터 또는 스냅샷을 덮어쓰거나 삭제하지 않아야 한다.
10. Web Locks API가 없는 브라우저에서는 한 탭 사용 안내가 표시되어야 한다. 이 대체 경로는 같은 탭 작업만 직렬화하므로 교차 탭 검증 대상으로 간주하지 않는다.
11. 브라우저 저장 용량 또는 락 획득 오류를 재현할 수 있는 검증 환경에서는 업로드가 사용자 업로드 상태로 표시되지 않고 한국어 저장 실패 안내가 보이며, 직전 정상 스냅샷이 그대로 복원되는지 확인한다.
12. 초기화에서 활성 포인터 제거는 성공하고 스냅샷 키 제거만 실패하도록 재현했을 때 화면은 즉시 시연 샘플로 전환되어야 한다. 비활성 고아는 최소 60초 뒤 재시도를 시작해 5분, 최대 15분 간격으로 성공할 때까지 계속 정리해야 하며 포커스·가시성 복귀에서도 다시 시도해야 한다.
13. 활성·비활성 세션 스냅샷을 서로 다른 시각에 생성한 뒤 가짜 시간 또는 검증용 브라우저 시계를 각 24시간 경계까지 진행한다. 물리 보존 타이머가 각 키를 자체 만료 시각에 제거하고, 삭제 실패 중에도 0ms 반복을 만들지 않으며, 정상 경로에서는 만료 경계 이후 사용자 스냅샷 키가 남지 않아야 한다.
14. 연속 12개월 표를 붙여넣고 미리보기를 적용하면 자동진단으로 이동하고 출처가 `고지서: 표 붙여넣기`로 표시되어야 한다.
15. 직접 입력에서 최근 12개월 행을 만든 뒤 여러 셀을 한 번에 붙여넣고, 적용 전에 새로고침해도 24시간 이내 초안이 복원되어야 한다. 적용 후에는 자동진단과 `고지서: 직접 입력` 출처가 보이고 초안 키와 포인터가 제거되어야 한다.
16. 사용 안내에서 GPT 변환 프롬프트 복사 상태를 확인하고 `el-bill-import.csv`를 내려받는다. 파일은 UTF-8 BOM으로 시작하고 첫 행은 안내에 명시된 14개 컬럼 헤더와 정확히 일치해야 하며, 원본에 없는 값을 추측하지 말라는 문구와 외부 AI 개인정보 경고가 유지되어야 한다.
17. 직접 입력 초안의 `expiresAt`을 과거로 만든 검증 브라우저에서는 다음 직접 입력 화면 진입 시 활성 generation 키와 `el-bill:bill-entry-draft-active` 포인터가 물리적으로 제거되어야 한다.
18. 390x844에서 파일 업로드·표 붙여넣기·직접 입력 탭이 겹치지 않고 모두 전환되어야 한다. 직접 입력의 안내 링크와 사용 안내의 모바일 항목 선택·이동 버튼도 겹치지 않으며 선택한 안내 제목으로 포커스가 이동해야 한다.

## 선택 대안: Hermes/Vercel

아래 항목은 현재 운영 경로가 아니다. NAS+Cloudflare 배포의 롤아웃, 롤백, 공개 URL 검증에 Hermes나 Vercel을 섞어 사용하지 않는다. 별도의 Vercel 프로젝트를 명시적으로 선택한 경우에만 적용한다.

### Vercel 설정

- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- SPA rewrite: `vercel.json`에서 모든 경로를 `/index.html`로 연결

### Hermes 지시문

Hermes에 배포를 맡길 때는 아래 지시를 사용한다.

```text
GitHub repo h19h29-design/el-bill 의 main 브랜치 최신 커밋을 Vercel 프로젝트로 배포해줘.
배포 전 npm ci, npm run typecheck, npm run lint, npm run test, npm run build, npm run test:e2e 를 모두 실행해.
Vercel 프로젝트나 토큰이 없으면 새 프로젝트를 임의 생성하지 말고 필요한 설정값만 보고해.
배포 후 공개 URL에서 자동진단 시작, 고지서 업로드, 파워플래너 CSV 업로드, 피크관리, 문서 ZIP/PDF 다운로드 smoke를 실행해.
ZIP 내부에 PDF 3종이 포함됐는지 확인하고, PDF를 이미지로 렌더링해 빈 페이지나 페이지 경계 잘림이 없는지 확인해.
모바일 390x844에서 메뉴가 접힌 상태로 시작하며 TOP 3 표와 문서 미리보기를 좌우 스크롤할 수 있는지 확인해.
```

### 대안 경로의 차단 조건

로컬에는 `hermes` CLI가 있지만, 실제 Vercel 프로젝트 연결과 배포 토큰은 repo에 저장하지 않는다. 운영 배포를 자동화하려면 Vercel 프로젝트 연결 또는 GitHub Actions용 Vercel secrets가 필요하다.
