# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

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

[Unreleased]: https://github.com/chojema/chojema-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chojema/chojema-editor/releases/tag/v0.1.0
