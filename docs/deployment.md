# Deployment

이 MVP의 기준 배포 타깃은 Vercel 정적 Vite 앱이다.

## 배포 전 필수 검증

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

## Vercel 설정

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
