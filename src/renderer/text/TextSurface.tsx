import { forwardRef, useImperativeHandle, useRef } from 'react'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { countWords, type SurfaceHandle, type SurfaceProps } from '../surface'
import { textPage } from '../exportPage'
import { t } from '../i18n/locale'

/** plain text files: the bytes are the document, no visual layer */
export const TextSurface = forwardRef<SurfaceHandle, SurfaceProps>(function TextSurface(
  { initialContent, path, wrap, zoom, onDirty, onStats },
  ref,
) {
  const codeRef = useRef<CodeEditorHandle>(null)
  const report = (text: string, lines: number) =>
    onStats({ words: countWords(text), chars: Array.from(text.replace(/\n/g, '')).length, lines })

  const text = () => codeRef.current?.getValue() ?? initialContent
  const title = () => path?.split(/[\\/]/).pop() ?? 'Untitled'

  useImperativeHandle(ref, () => ({
    getContent: text,
    markSaved: () => {},
    // plain text has a single view
    setMode: () => {},
    toggleSource: () => {},
    toggleOutline: () => {},
    openFind: () => codeRef.current?.openFind(),
    exportPage: async () => ({ html: textPage(text(), title()), baseDir: null }),
    richCopy: async () => {
      const page = textPage(text(), title())
      return { html: page.slice(page.indexOf('<pre>'), page.indexOf('</pre>') + 6), text: text() }
    },
  }))

  return (
    <div className="surface">
      <div className="surface-source text-surface">
        <CodeEditor
          ref={codeRef}
          initialValue={initialContent}
          language="text"
          wrap={wrap}
          fontScale={zoom / 100}
          placeholder={t('placeholder')}
          onChange={() => onDirty()}
          onStats={({ lines }) => report(codeRef.current?.getValue() ?? initialContent, lines)}
        />
      </div>
    </div>
  )
})
