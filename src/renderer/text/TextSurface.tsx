import { forwardRef, useImperativeHandle, useRef } from 'react'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { countWords, type SurfaceHandle, type SurfaceProps } from '../surface'
import { t } from '../i18n/locale'

/** plain text files: the bytes are the document, no visual layer */
export const TextSurface = forwardRef<SurfaceHandle, SurfaceProps>(function TextSurface(
  { initialContent, wrap, zoom, onDirty, onStats },
  ref,
) {
  const codeRef = useRef<CodeEditorHandle>(null)
  const report = (text: string, lines: number) =>
    onStats({ words: countWords(text), chars: Array.from(text.replace(/\n/g, '')).length, lines })

  useImperativeHandle(ref, () => ({
    getContent: () => codeRef.current?.getValue() ?? initialContent,
    markSaved: () => {},
    toggleSource: () => {},
    openFind: () => codeRef.current?.openFind(),
  }))

  return (
    <div className="surface">
      <div className="surface-source text-surface" style={{ zoom: zoom / 100 }}>
        <CodeEditor
          ref={codeRef}
          initialValue={initialContent}
          language="text"
          wrap={wrap}
          placeholder={t('placeholder')}
          onChange={() => onDirty()}
          onStats={({ lines }) => report(codeRef.current?.getValue() ?? initialContent, lines)}
        />
      </div>
    </div>
  )
})
