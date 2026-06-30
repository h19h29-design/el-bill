# OSS Research

조사일: 2026-06-30

| 이름 | 용도 | 확인 버전 | 라이선스 | 선택/제외 | 링크 |
| --- | --- | ---: | --- | --- | --- |
| Vite | React 앱 번들러/개발 서버 | 8.1.0 | MIT | 선택. 빠른 MVP 구성과 타입스크립트 빌드에 적합 | https://vite.dev, https://github.com/vitejs/vite |
| React | UI 프레임워크 | 19.2.7 | MIT | 선택. Vite 템플릿 기본값 | https://react.dev, https://github.com/facebook/react |
| Tailwind CSS | 유틸리티 CSS 및 디자인 토큰 보조 | 4.3.2 | MIT | 선택. `@tailwindcss/vite`로 Vite 연동 | https://tailwindcss.com, https://github.com/tailwindlabs/tailwindcss |
| Recharts | 대시보드 차트 | 3.9.0 | MIT | 선택. React 컴포넌트 기반 라인/바/도넛 차트 구현이 빠름 | https://recharts.org, https://github.com/recharts/recharts |
| SheetJS/xlsx | 엑셀 업로드 파싱 | 0.18.5 | Apache-2.0 | 선택하되 리스크 문서화. 요구 스택이고 브라우저 로컬 파싱에 적합하지만 npm audit 취약점 fix 없음 | https://sheetjs.com, https://github.com/SheetJS/sheetjs |
| TanStack Table | 고지서 입력 테이블 | 8.21.3 | MIT | 선택. 컬럼 확장과 표 렌더링 제어가 좋음 | https://tanstack.com/table, https://github.com/TanStack/table |
| React Hook Form | 시나리오 입력 폼 | 7.80.0 | MIT | 선택. 입력 상태 관리가 가볍고 Zod와 함께 사용 가능 | https://react-hook-form.com, https://github.com/react-hook-form/react-hook-form |
| Zod | 폼 입력 검증 | 4.4.3 | MIT | 선택. 피크/사용량 숫자 범위 검증 | https://zod.dev, https://github.com/colinhacks/zod |
| html2pdf.js | DOM 기반 PDF 다운로드 | 0.14.0 | MIT | 선택. 문서 미리보기 DOM을 PDF로 저장 | https://ekoopmans.github.io/html2pdf.js, https://github.com/eKoopmans/html2pdf.js |
| jsPDF | PDF 생성 보조 | 4.2.1 | MIT | 선택. html2pdf.js 하위 PDF 생성과 직접 PDF 확장 가능성 | https://github.com/parallax/jsPDF |
| html2canvas | PDF 렌더링 보조 | 1.4.1 | MIT | 선택. html2pdf.js와 함께 DOM 캡처 | https://html2canvas.hertzen.com, https://github.com/niklasvh/html2canvas |
| JSZip | 문서 묶음 ZIP 생성 | 3.10.1 | MIT/GPLv3 dual | 선택. 서버 없이 텍스트/JSON 문서 묶음 제공 | https://stuk.github.io/jszip, https://github.com/Stuk/jszip |
| lucide-react | 사이드바/버튼 아이콘 | 1.22.0 | ISC | 선택. 일관된 선형 아이콘 제공 | https://lucide.dev, https://github.com/lucide-icons/lucide |

## GitHub 예제 검색

| 검색어 | 결과 | 판단 |
| --- | --- | --- |
| `electricity billing dashboard` | `sumitranjan52-code/Smart-Electricity-billing` 등 소규모 대시보드 예제 확인 | 코드 복사 없음. 별점 0, 프로젝트별 품질 편차가 커서 UI/기능 아이디어만 참고 |
| `peak demand dashboard electricity` | 검색 결과 없음 | 별도 오픈소스 의존성 없이 자체 피크 위험도 판정 구현 |

## 보안/유지보수 메모

- `npm audit --omit=dev` 결과 `xlsx`에서 Prototype Pollution, ReDoS 고위험 취약점이 보고됨.
- 현재 npm 기준 fix 없음. 원격 서버 파싱을 만들지 않고 브라우저 로컬 파일 처리로 범위를 제한.
- 실제 운영 전에는 SheetJS 대체 패키지 또는 샌드박스 파서 검토 필요.
- 라이선스 불명 또는 저활성 GitHub 예제 코드는 포함하지 않음.
