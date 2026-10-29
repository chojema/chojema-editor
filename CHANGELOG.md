# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

## [0.3.0] - 2026-10-29

### Added
- 상태 표시줄의 글자 크기 − / + 버튼. 텍스트 문서와 소스 화면의 글자 크기도 함께 바뀜.
- 선택 시 복사(상태 표시줄 버튼, 편집 메뉴): 켜면 선택하는 즉시 클립보드에 복사하고 "복사됨"을 잠깐 표시. 설정은 모든 창에 함께 적용되고 기억됨.
- 상태 표시줄의 문서 종류(Markdown ▾)를 눌러 텍스트·Markdown·HTML 문서로 바꾸기.

### Changed
- 파일 메뉴에 "PDF로 내보내기…"(`⇧⌘E`)와 "인쇄…"(`⌘P`)를 각각 독립 항목으로 둠. 내보내기 하위 메뉴에는 HTML로 저장과 서식 있는 텍스트로 복사만 남김.
- "최근 문서" 메뉴 이름을 한국어로 표시.
- "새 … 문서" 메뉴: 아직 비어 있는 창은 새 창을 열지 않고 그 자리에서 문서 종류를 바꿈.

### Fixed
- 새 HTML 문서의 편집 영역이 좁은 세로 띠로 줄어들던 문제.

## [0.2.0] - 2026-10-29

### Added
- 나란히 보기(`⌘2`): Markdown과 HTML 모두 왼쪽 소스·오른쪽 편집 화면을 함께 보며 양쪽에서 편집. 서로 자동 반영, 스크롤 연동, 폭 조절. 보기 방식은 문서 종류별로 기억.
- 개요 패널(`⇧⌘O`): 제목 목록에서 눌러 이동.
- 편집 화면의 찾아 바꾸기(`⌥⌘F`): 하나씩 바꾸기, 모두 바꾸기(한 번에 실행 취소 가능).
- 내보내기: HTML로 저장(이미지 포함 한 파일), PDF로 저장, 서식 있는 텍스트로 복사, 인쇄(`⌘P`).
- 문서 속성(frontmatter) 편집 상자.
- 코드 블록 문법 색상.
- 테마 선택(시스템/밝게/어둡게).
- 문서 파일을 창에 끌어다 놓아 열기.
- 상태 표시줄에 인코딩과 줄바꿈 방식 표시.

### Fixed
- EUC-KR(CP949)·UTF-16 파일이 깨져 보이던 문제. 이제 알아서 읽고, UTF-8로 저장하기 전에 확인.
- `⌘K` 링크 단축키가 동작하지 않던 문제.
- 텍스트 문서와 소스 보기에서 CRLF 줄바꿈이 LF로 바뀌던 문제.
- 설치 파일에 LICENSE·NOTICE가 빠져 있던 문제.

## [0.1.0] - 2026-10-29

첫 공개 버전입니다.

### Added
- 일반 텍스트 편집: 줄 번호, 찾기, 자동 줄 바꿈.
- Markdown 위지위그 편집과 소스 보기: 표, 할 일 목록, 수식(KaTeX), Mermaid·WaveDrom 다이어그램, 각주, `/` 명령 메뉴.
- Markdown 원문 보존 저장: 고치지 않은 블록은 원래 글자 그대로 저장하고, 앞머리(frontmatter)·줄바꿈 방식·BOM을 유지.
- HTML 위지위그 편집과 소스 보기: 글꼴·크기·색·배경색·정렬·첨자, 표, 이미지, 링크.
- HTML 원문 보존: `<head>`와 `<body>` 태그를 그대로 두고, 문서 CSS를 편집 화면에 적용. class·id·style·data-* 속성과 레이아웃 요소 유지. `<script>`·`<iframe>`·`<form>`·SVG 등은 원래 코드로 보존.
- 붙여넣은 이미지를 문서 옆 `assets/` 폴더에 저장.
- macOS(Apple Silicon) DMG, Windows(x64·ARM64) 설치 파일.

[Unreleased]: https://github.com/chojema/chojema-editor/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/chojema/chojema-editor/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/chojema/chojema-editor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/chojema/chojema-editor/releases/tag/v0.1.0
