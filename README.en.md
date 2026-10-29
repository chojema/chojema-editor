# Chojema Editor

[한국어](README.md) | **English**

A desktop editor for plain text, Markdown and HTML. Markdown and HTML are edited WYSIWYG (what you see is what you get).

## Installation

Download the file for your system from [Releases](https://github.com/chojema/chojema-editor/releases).

| System | File |
|---|---|
| macOS (Apple Silicon, M1 and later) | `Chojema.Editor-<version>-arm64.dmg` |
| Windows (regular PCs, Intel/AMD) | `Chojema.Editor-Setup-<version>-x64.exe` |
| Windows (ARM, e.g. Snapdragon laptops) | `Chojema.Editor-Setup-<version>-arm64.exe` |
| Windows (not sure which) | `Chojema.Editor-Setup-<version>.exe` — picks the right one during setup |

- **macOS**: open the DMG and drag the app into the Applications folder. If macOS blocks the first launch, Control-click the app in Finder and choose "Open", or click "Open Anyway" in System Settings → Privacy & Security.
- **Windows**: the setup wizard lets you choose the install folder and needs no administrator rights. If "Windows protected your PC" appears, click "More info" → "Run anyway".
- After installation, `.md`, `.markdown`, `.html`, `.htm` and `.txt` files can be opened with the app.

## Features

| Document | Editing |
|---|---|
| `.txt` and others | Text editing (line numbers, find & replace, line wrapping) |
| `.md` | WYSIWYG editing. Tables, task lists, math (LaTeX), Mermaid diagrams, footnotes, code syntax colors, `/` command menu, frontmatter editing |
| `.html` | WYSIWYG editing. Font, size, color, alignment, sub/superscript, tables, images, links, code syntax colors |

### Views (Markdown and HTML)

Switch with the buttons at the right of the toolbar or the shortcuts.

| View | Shortcut | What you get |
|---|---|---|
| Visual | `⌘1` | WYSIWYG editing only |
| Side by side | `⌘2` | Source on the left, visual on the right. **Both are editable** and each follows the other after a short pause. Scrolling is linked; drag the divider to resize |
| Source | `⌘3` | Source code only |

For Markdown, a visual edit in the side-by-side view rewrites only the edited block in the source; every other line stays as written.

The source pane colours tags, attributes, values and comments (with separate light and dark colours) and offers completions while you type HTML tags and attributes. Typing an opening tag such as `<p>` adds the closing tag. Turn completions on or off in Edit → Source Autocomplete.

### Changing the document type

The app opens with an empty Markdown document. Click the document type at the left of the status bar (**Markdown ▾**), or choose New Text Document (`⌘N`), New Markdown Document (`⇧⌘N`) or New HTML Document (`⌥⌘N`) in the File menu. A window you have not typed in yet switches in place; a window with content or a saved file opens a new window instead.

### More

- **Outline** (`⇧⌘O`): list of headings; click one to jump there
- **Find & replace** (`⌘F`, `⌥⌘F`): match case, replace, replace all
- **Export to PDF** (File menu, `⇧⌘E`) and **Print** (File menu, `⌘P`)
- **Export** (File → Export): save as HTML (one file with images embedded), copy as formatted text (for mail and blogs)
- **Legacy Korean files**: EUC-KR (CP949) and UTF-16 files open correctly; the status bar shows the encoding and line endings (LF/CRLF). Files are saved as UTF-8, with a confirmation the first time
- **Drag and drop**: drop a `.md`, `.html` or `.txt` file on the window to open it
- **Text size**: the **− 100% +** buttons at the right of the status bar (`⌘−` / `⌘=`, `⌘0` for actual size). Applies to text documents, the visual editor and the source pane
- **Copy on select**: turn it on with the **Copy on select** button in the status bar or Edit → Copy on Select. Selected text then goes to the clipboard right away and a short "✓ Copied" tag appears; the visual editor copies formatting too
- **Language** (View → Language: Follow System / 한국어 / English). Applies immediately to all windows while preserving your edits.
- **Links** (`⌘K`), **themes** (View → Theme: system / light / dark)

### How the original text is preserved

- **Markdown**: blocks you did not edit are saved exactly as they were on disk. Opening a file and saving it unchanged produces a byte-identical file. Frontmatter, line endings (CRLF) and the BOM are kept.
- **HTML**: only the inside of `<body>` is edited; `<head>` and the `<body>` tag stay exactly as written. The document's own CSS is applied to the editing canvas, so you edit the page as a browser shows it. class, id, style and data-* attributes and layout elements such as `<div>`/`<section>` are kept. Elements that cannot be edited visually, such as `<script>`, `<iframe>`, `<form>` and SVG, keep their original code; double-click one to edit its code.

### Limits of HTML editing

- HTML comments (`<!-- -->`) are lost on save.
- After an edit, the saved body is laid out one block per line, and some CSS values may be rewritten (e.g. `#d33` → `rgb(221, 51, 51)`). A file you did not edit is saved exactly as it was.
- Table columns cannot be resized with the mouse.

## Changelog

Changes in each version are listed in [CHANGELOG.md](CHANGELOG.md) (in Korean).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for notices.
