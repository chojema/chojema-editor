import type { EditableKind } from '../../shared/ipc'
import { t } from '../i18n/locale'

export function TargetFormatDialog({
  fileName,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  fileName: string
  busy: boolean
  error: string | null
  onChoose: (kind: EditableKind) => void
  onCancel: () => void
}) {
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div className="modal modal-compact" role="dialog" aria-label={t('importTargetTitle')}>
        <div className="modal-title">{t('importTargetTitle')}</div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>{t('importTargetDesc', { name: fileName })}</p>
          {busy ? (
            <p style={{ margin: '8px 0', color: 'var(--text-muted)' }}>{t('importConverting')}</p>
          ) : (
            <div className="modal-choice-list">
              <button type="button" className="modal-choice" autoFocus onClick={() => onChoose('markdown')}>
                <span className="modal-choice-title">{t('kindMarkdown')}</span>
                <span className="modal-choice-desc">{t('importTargetMarkdownDesc')}</span>
              </button>
              <button type="button" className="modal-choice" onClick={() => onChoose('html')}>
                <span className="modal-choice-title">{t('kindHtml')}</span>
                <span className="modal-choice-desc">{t('importTargetHtmlDesc')}</span>
              </button>
              <button type="button" className="modal-choice" onClick={() => onChoose('text')}>
                <span className="modal-choice-title">{t('kindText')}</span>
                <span className="modal-choice-desc">{t('importTargetTextDesc')}</span>
              </button>
            </div>
          )}
          {error && (
            <p role="alert" style={{ margin: 0, color: 'var(--src-invalid)' }}>
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ImportModeDialog({
  fileName,
  onSelect,
  onCancel,
}: {
  fileName: string
  onSelect: (mode: 'replace' | 'append') => void
  onCancel: () => void
}) {
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <div className="modal modal-compact" role="dialog" aria-label={t('importModeTitle')}>
        <div className="modal-title">{t('importModeTitle')}</div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>{t('importModeDesc', { name: fileName })}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className="btn" onClick={() => onSelect('append')}>
            {t('importAppend')}
          </button>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => onSelect('replace')}>
            {t('importReplace')}
          </button>
        </div>
      </div>
    </div>
  )
}
