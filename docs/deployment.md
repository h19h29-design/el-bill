# Deployment

이 MVP는 정적 Vite 앱이다. 현재 운영 배포는 NAS의 정적 파일 경로를 Cloudflare를 통해 공개하는 방식이며, `vercel.json`은 대체 정적 호스팅 설정으로만 유지한다. 배포 비밀값, NAS 접속 정보, Cloudflare API 토큰은 repo에 저장하지 않는다.

## 배포 전 필수 검증

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

빌드 후에는 `dist/assets/index-*.js`의 가장 큰 초기 `index` 청크가 700 kB 미만인지 확인한다. 문서 PDF 라이브러리와 대시보드·요금제 비교·피크·문서 생성 화면은 지연 로드되어 초기 진입 청크에 포함되지 않아야 한다.

## 운영 배포와 롤백

1. 검증된 커밋에서 `npm ci`와 전체 로컬 게이트를 통과한 뒤 `npm run build`를 실행한다.
2. NAS의 현재 정적 사이트 디렉터리를 타임스탬프가 붙은 백업 디렉터리로 보관한다. 새 `dist`는 임시 경로에 올린 뒤, 업로드가 완전한지 확인하고 정적 사이트 경로로 원자적으로 교체한다.
3. Cloudflare 뒤의 공개 URL에서 아래 운영 스모크를 완료한다. 해시된 정적 자산은 새 파일명을 사용하므로, 정상 캐시 정책에서는 전역 캐시 삭제가 필수는 아니다. 오래된 HTML이 계속 보일 때만 운영자가 제한된 범위의 캐시 무효화를 검토한다.
4. 실패하면 새 사이트 디렉터리를 제거하고 직전 타임스탬프 백업을 원래 정적 사이트 경로로 되돌린다. 롤백 후 공개 URL의 첫 화면과 콘솔 오류를 다시 확인한다.

NAS 또는 Cloudflare를 변경하기 전에는 대상 경로, 현재 백업, 공개 도메인을 운영 담당자가 다시 확인해야 한다. 이 문서는 배포 명령을 자동 실행하지 않는다.

## 운영 스모크

배포 후 [https://el-bill.h19h19.com/](https://el-bill.h19h19.com/)에서 체크인된 합성 XLSX와 파워플래너 CSV를 사용해 다음을 확인한다.

1. 고지서 XLSX가 연속 12개월로 인식되고 자동진단이 사용자 고지서 상태로 전환된다.
2. 파워플래너 파일만 올리면 고지서는 시연 샘플 상태를 유지하고 변경신청 ZIP은 비활성화된다.
3. 업로드 자료가 추천 결과와 피크관리 차트 및 입력값에 반영된다.
4. 사용자 표시명으로 생성된 ZIP에 PDF 3종이 포함되고 각 PDF가 `%PDF` 헤더와 정상 크기를 가진다.
5. 390x844 모바일에서 메뉴, TOP 3 표의 가로 스크롤, 문서 미리보기 가로 스크롤이 동작한다.
6. 페이지 및 콘솔 오류는 0건이어야 한다. Cloudflare Analytics/Telemetry 같은 외부 관측 요청 실패는 앱 오류와 분리해 기록한다.

## 대체 Vercel 설정

- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- SPA rewrite: `vercel.json`에서 모든 경로를 `/index.html`로 연결

## Hermes 배포 지시문

Hermes에 배포를 맡길 때는 아래 지시를 사용한다.

```text
GitHub repo h19h29-design/el-bill 의 main 브랜치 최신 커밋을 Vercel 프로젝트로 배포해줘.
배포 전 npm ci, npm run typecheck, npm run lint, npm run test, npm run build, npm run test:e2e 를 모두 실행해.
Vercel 프로젝트나 토큰이 없으면 새 프로젝트를 임의 생성하지 말고 필요한 설정값만 보고해.
배포 후 공개 URL에서 자동진단 시작, 고지서 업로드, 파워플래너 CSV 업로드, 피크관리, 문서 ZIP/PDF 다운로드 smoke를 실행해.
ZIP 내부에 PDF 3종이 포함됐는지 확인하고, PDF를 이미지로 렌더링해 빈 페이지나 페이지 경계 잘림이 없는지 확인해.
모바일 390x844에서 메뉴가 접힌 상태로 시작하며 TOP 3 표와 문서 미리보기를 좌우 스크롤할 수 있는지 확인해.
```

## 현재 차단 조건

로컬에는 `hermes` CLI가 있지만, 실제 Vercel 프로젝트 연결과 배포 토큰은 repo에 저장하지 않는다. 운영 배포를 자동화하려면 Vercel 프로젝트 연결 또는 GitHub Actions용 Vercel secrets가 필요하다.
