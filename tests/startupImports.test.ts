import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

/** Inspect eager source edges without producing or replacing any build output. */
function eagerImports(entry: string) {
  const files = new Set<string>()
  const packages = new Set<string>()
  function visit(file: string) {
    if (files.has(file)) return
    files.add(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const clause = statement.importClause
      if (clause?.isTypeOnly) continue
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.every(item => item.isTypeOnly)) continue
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith('.')) { packages.add(specifier); continue }
      const base = resolve(dirname(file), specifier)
      const target = [base, base + '.ts', base + '.tsx', resolve(base, 'index.ts')]
        .find(candidate => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate))
      if (target) visit(target)
    }
  }
  visit(resolve(entry))
  return { files: [...files], packages: [...packages] }
}

it.each(['src/renderer/main.tsx', 'src/web/main.ts'])('%s keeps rich editors, grammars and export converters off the eager text path', (entry) => {
  const imports = eagerImports(entry)
  expect(imports.packages.filter(name => /^(?:@tiptap\/|@codemirror\/lang-|katex|mermaid|wavedrom|turndown)/.test(name))).toEqual([])
  expect(imports.files.filter(name => /(?:MarkdownSurface|HtmlSurface|JsonSurface|SvgSurface|toMarkdown|jsonLint|exportPage)\.tsx?$/.test(name))).toEqual([])
})
