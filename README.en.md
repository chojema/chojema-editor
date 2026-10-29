# Chojema Editor

[한국어](README.md) | **English**

A desktop editor for plain text, Markdown and HTML. Markdown and HTML are edited WYSIWYG (what you see is what you get).

## Installation

Download the file for your system from [Releases](https://github.com/chojema/chojema-editor/releases).

| System | File |
|---|---|
| macOS (Apple Silicon) | `Chojema Editor-<version>-arm64.dmg` |
| Windows (Intel/AMD) | `Chojema Editor-Setup-<version>-x64.exe` |
| Windows (ARM) | `Chojema Editor-Setup-<version>-arm64.exe` |

The builds are not code-signed, so your system may warn you the first time you open the app. See "Building installers" below.

## Features

| Document | Editing |
|---|---|
| `.txt` and others | CodeMirror text editor (line numbers, find, line wrapping) |
| `.md` | TipTap WYSIWYG + source view. Tables, task lists, math (KaTeX), Mermaid diagrams, footnotes, `/` command menu |
| `.html` | TipTap WYSIWYG + source view. Font, size, color, alignment, sub/superscript, tables, images, links |

### How the original text is preserved

- **Markdown**: blocks you did not edit are saved exactly as they were on disk. Opening a file and saving it unchanged produces a byte-identical file. Frontmatter, line endings (CRLF) and the BOM are kept.
- **HTML**: only the inside of `<body>` is edited; `<head>` and the `<body>` tag stay exactly as written. The document's own CSS is applied to the editing canvas, so you edit the page as a browser shows it. class, id, style and data-* attributes and layout elements such as `<div>`/`<section>` are kept. Elements that cannot be edited visually, such as `<script>`, `<iframe>`, `<form>` and SVG, keep their original code; double-click one to edit its code.

### Limits of HTML editing

- HTML comments (`<!-- -->`) are lost on save.
- After an edit, the saved body is laid out one block per line, and some CSS values may be rewritten (e.g. `#d33` → `rgb(221, 51, 51)`). A file you did not edit is saved exactly as it was.
- Table columns cannot be resized with the mouse (turned off so the document's table CSS applies).

## Versioning

The project follows [Semantic Versioning](https://semver.org/) `MAJOR.MINOR.PATCH`; changes are recorded in [CHANGELOG.md](CHANGELOG.md) (in Korean).

- **PATCH** `0.1.0 → 0.1.1`: bug fixes
- **MINOR** `0.1.0 → 0.2.0`: new features
- **MAJOR** `0.x → 1.0.0`: the first release called stable, or a breaking change

To publish a new version:

```bash
# 1. Move the [Unreleased] entries in CHANGELOG.md under the new version heading and commit
# 2. Bump the version: edits package.json, commits "Release vX.Y.Z" and tags vX.Y.Z in one step
npm version patch        # or minor / major
# 3. Push
git push --follow-tags
# 4. Build the installers and attach them to a GitHub release
npm run dist:mac && npm run dist:win
gh release create vX.Y.Z dist/*.dmg dist/*Setup*.exe --title "vX.Y.Z" --notes-file <release notes>
```

Release notes follow [docs/release-notes-template.md](docs/release-notes-template.md): Korean first, then English.

The app version comes only from `version` in `package.json`. It appears in the installer file names and in the About window (macOS: app menu, Windows: Help menu).

## Development

Requires Node 22.12 or later.

```bash
npm install          # also downloads the Electron binary
npm run dev          # run in development mode
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # build into out/
npm run dist:mac     # macOS installer (dist/Chojema Editor-<version>-arm64.dmg)
npm run dist:win     # Windows installers (dist/Chojema Editor-Setup-<version>-*.exe), can be built on macOS
```

## Building installers

### macOS

- Open `dist/Chojema Editor-0.1.0-arm64.dmg` and drag the app into the Applications folder.
- The build targets Apple Silicon (M1 and later). For Intel Macs use `npx electron-builder --mac dmg --x64`; for one file covering both, use `--universal`.
- The build is neither signed nor notarized. If macOS blocks the first launch, Control-click the app in Finder and choose "Open", or click "Open Anyway" in System Settings → Privacy & Security. Distributing to others requires signing and notarizing with an Apple Developer ID.
- Without a signing certificate, build with `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`.
- The libraries the app uses (katex, mermaid, wavedrom, …) are bundled into the renderer at build time, so all of them live in `devDependencies`. Listing them in `dependencies` would copy node_modules into the installer as well, adding about 130 MB.

### Windows

| File | For |
|---|---|
| `Chojema Editor-Setup-0.1.0-x64.exe` | Regular Windows PCs (Intel/AMD) |
| `Chojema Editor-Setup-0.1.0-arm64.exe` | ARM Windows (Snapdragon laptops etc.) |
| `Chojema Editor-Setup-0.1.0.exe` | Combined installer with both; picks the right one during setup |

- The setup wizard lets you choose the install folder and installs for the current user without administrator rights. It creates desktop and Start menu shortcuts.
- The installers are not code-signed, so SmartScreen ("Windows protected your PC") may appear on first run. Click "More info" → "Run anyway". Distribution requires a Windows code-signing certificate.
- .md, .markdown, .html, .htm and .txt files are registered to open with the app.

## Project layout

```
build/           App icon: icon.svg (source), icon.icns (macOS), icon.ico (Windows), icon.png (1024 px)
src/main/        Electron main process: windows, menus, open/save, md-asset:// protocol
src/preload/     Exposes window.editorApi to the renderer
src/shared/      IPC contract and document-type detection
src/renderer/
  App.tsx        Picks the editing surface by document type; save; status bar
  text/          CodeMirror editor (text documents, source views)
  markdown/      Markdown surface and text-preserving serialization
  editor/        TipTap extensions for Markdown
  html/          HTML surface, attribute preservation, preserved blocks, CSS scoping
  components/    Toolbar, find bar, table menu, slash menu, …
tests/           HTML and Markdown round-trip tests
```

## App icon

The source is `build/icon.svg`. After changing it, regenerate `icon.png` (1024 px), `icon.icns` (16–1024 px, packed with `iconutil`) and `icon.ico` (16–256 px) from it.

## Future work

AI features are planned for a later version. The plan is in [docs/FUTURE-AI.md](docs/FUTURE-AI.md) (in Korean).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for notices.
