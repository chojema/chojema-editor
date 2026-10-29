# Chojema Editor

**한국어** | [English](README.en.md)

일반 텍스트, Markdown, HTML을 편집하는 데스크톱 편집기입니다. Markdown과 HTML은 위지위그(보이는 그대로) 방식으로 편집합니다.

## 설치

[Releases](https://github.com/chojema/chojema-editor/releases)에서 운영체제에 맞는 파일을 내려받습니다.

| 운영체제 | 파일 |
|---|---|
| macOS (Apple Silicon) | `Chojema Editor-<버전>-arm64.dmg` |
| Windows (Intel·AMD) | `Chojema Editor-Setup-<버전>-x64.exe` |
| Windows (ARM) | `Chojema Editor-Setup-<버전>-arm64.exe` |

코드 서명을 하지 않은 빌드라서 처음 열 때 경고가 뜰 수 있습니다. 자세한 내용은 아래 "설치 파일 만들기"를 참고하세요.

## 기능

| 문서 | 편집 방식 |
|---|---|
| `.txt` 등 | CodeMirror 텍스트 편집기 (줄 번호, 찾기, 자동 줄 바꿈) |
| `.md` | TipTap 위지위그 + 소스 보기. 표, 할 일 목록, 수식(KaTeX), Mermaid 다이어그램, 각주, `/` 명령 메뉴 |
| `.html` | TipTap 위지위그 + 소스 보기. 글꼴·크기·색·정렬·첨자, 표, 이미지, 링크 |

### 원본 보존 방식

- **Markdown**: 고치지 않은 블록은 디스크에 있던 글자 그대로 저장합니다. 문서를 열었다가 그대로 저장하면 파일이 바이트 단위로 같습니다. 앞머리(frontmatter), 줄바꿈 방식(CRLF), BOM도 유지합니다.
- **HTML**: `<body>` 안쪽만 편집하고 `<head>`와 `<body>` 태그는 원문 그대로 둡니다. 문서의 CSS를 편집 화면에 적용해 브라우저에서 보는 모습으로 편집합니다. class·id·style·data-* 속성, `<div>`/`<section>` 같은 레이아웃 요소는 유지됩니다. `<script>`, `<iframe>`, `<form>`, SVG처럼 화면에서 직접 고칠 수 없는 요소는 원래 코드를 그대로 보존하고, 두 번 클릭하면 코드를 고칠 수 있습니다.

### HTML 편집의 한계

- HTML 주석(`<!-- -->`)은 저장할 때 사라집니다.
- 내용을 고친 뒤 저장하면 본문 블록이 한 줄씩 정리되고, 일부 CSS 값 표기가 바뀔 수 있습니다(예: `#d33` → `rgb(221, 51, 51)`). 아무것도 고치지 않았다면 원문 그대로 저장합니다.
- 표 열 너비를 마우스로 조절하는 기능은 없습니다(문서의 표 CSS를 살리기 위해 껐습니다).

## 버전 관리

[유의적 버전(SemVer)](https://semver.org/lang/ko/) `주.부.수`를 따르고, 변경 사항은 [CHANGELOG.md](CHANGELOG.md)에 적습니다.

- **수(patch)** `0.1.0 → 0.1.1`: 버그 수정
- **부(minor)** `0.1.0 → 0.2.0`: 기능 추가
- **주(major)** `0.x → 1.0.0`: 처음으로 안정판이라 부를 때, 또는 호환이 깨지는 변경

새 버전을 낼 때:

```bash
# 1. CHANGELOG.md의 [Unreleased] 내용을 새 버전 제목 아래로 옮기고 커밋
# 2. 버전 올리기: package.json 수정 + "Release vX.Y.Z" 커밋 + vX.Y.Z 태그를 한 번에 만듦
npm version patch        # 또는 minor / major
# 3. 올리기
git push --follow-tags
# 4. 설치 파일을 만들어 GitHub 릴리스에 첨부
npm run dist:mac && npm run dist:win
gh release create vX.Y.Z dist/*.dmg dist/*Setup*.exe --title "vX.Y.Z" --notes-file <릴리스 노트>
```

릴리스 노트는 [docs/release-notes-template.md](docs/release-notes-template.md) 형식으로 한국어를 먼저, 영문을 뒤에 씁니다.

앱의 버전은 `package.json`의 `version` 하나에서 나오며, 설치 파일 이름과 앱 정보 창(macOS: 앱 메뉴, Windows: 도움말 메뉴)에 표시됩니다.

## 개발

Node 22.12 이상이 필요합니다.

```bash
npm install          # Electron 바이너리도 함께 내려받습니다
npm run dev          # 개발 모드 실행
npm test             # 단위 테스트 (vitest)
npm run typecheck
npm run build        # out/ 에 빌드
npm run dist:mac     # macOS 설치 파일 (dist/Chojema Editor-<버전>-arm64.dmg)
npm run dist:win     # Windows 설치 파일 (dist/Chojema Editor-Setup-<버전>-*.exe), macOS에서도 만들 수 있음
```

## 설치 파일 만들기

### macOS 설치 파일

- `dist/Chojema Editor-0.1.0-arm64.dmg`를 열고 앱을 Applications 폴더로 끌어 넣으면 설치됩니다.
- Apple Silicon(M1 이후)용입니다. Intel Mac용은 `npx electron-builder --mac dmg --x64`, 두 가지를 한 파일에 담으려면 `--universal`로 만듭니다.
- 코드 서명과 공증을 하지 않은 빌드입니다. 처음 열 때 macOS가 막으면 Finder에서 앱을 Control-클릭 → "열기"를 누르거나, 시스템 설정 → 개인정보 보호 및 보안에서 "확인 없이 열기"를 누릅니다. 다른 사람에게 배포하려면 Apple Developer ID로 서명·공증해야 합니다.
- 서명 인증서가 없는 환경에서는 `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`으로 만듭니다.
- 앱에서 쓰는 라이브러리(katex, mermaid, wavedrom 등)는 빌드할 때 렌더러 번들에 들어가므로 모두 `devDependencies`에 둡니다. `dependencies`에 넣으면 설치 파일에 node_modules가 중복으로 들어가 약 130MB가 늘어납니다.

### Windows 설치 파일

| 파일 | 대상 |
|---|---|
| `Chojema Editor-Setup-0.1.0-x64.exe` | 일반 Windows PC (Intel·AMD) |
| `Chojema Editor-Setup-0.1.0-arm64.exe` | ARM Windows (Snapdragon 노트북 등) |
| `Chojema Editor-Setup-0.1.0.exe` | 두 가지를 모두 담은 통합본. 설치할 때 PC에 맞는 쪽을 고름 |

- 설치 마법사에서 설치 폴더를 고를 수 있고, 관리자 권한 없이 사용자 계정에 설치됩니다. 바탕 화면과 시작 메뉴에 바로가기를 만듭니다.
- 코드 서명을 하지 않았으므로 처음 실행할 때 SmartScreen 경고("Windows의 PC 보호")가 뜰 수 있습니다. "추가 정보" → "실행"을 누르면 설치됩니다. 배포하려면 Windows 코드 서명 인증서가 필요합니다.
- .md, .markdown, .html, .htm, .txt 파일을 이 앱으로 열 수 있게 등록합니다.

## 구조

```
build/           앱 아이콘: icon.svg(원본), icon.icns(macOS), icon.ico(Windows), icon.png(1024px)
src/main/        Electron 메인 프로세스: 창, 메뉴, 파일 열기/저장, md-asset:// 프로토콜
src/preload/     렌더러에 window.editorApi 제공
src/shared/      IPC 계약과 문서 종류 판별
src/renderer/
  App.tsx        문서 종류에 따라 편집 화면 선택, 저장, 상태 표시줄
  text/          CodeMirror 편집기 (텍스트 문서, 소스 보기)
  markdown/      Markdown 편집 화면, 원문 보존 직렬화
  editor/        Markdown용 TipTap 확장
  html/          HTML 편집 화면, 속성 보존, 보존 블록, CSS 범위 지정
  components/    툴바, 찾기, 표 메뉴, 슬래시 메뉴 등
tests/           HTML·Markdown 왕복 변환 테스트
```

## 앱 아이콘

원본은 `build/icon.svg`입니다. 고친 뒤에는 이 SVG에서 `icon.png`(1024px), `icon.icns`(16~1024px, `iconutil`로 묶음), `icon.ico`(16~256px)를 다시 만들어야 합니다.

## 추후 과제

AI 기능은 나중에 추가할 예정입니다. 계획은 [docs/FUTURE-AI.md](docs/FUTURE-AI.md)에 있습니다.

## 라이선스

[Apache License 2.0](LICENSE). 고지 사항은 [NOTICE](NOTICE)를 참고하세요.
