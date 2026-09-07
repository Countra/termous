import { useState } from 'react'
import { Button, Modal } from 'antd'
import { Copy, FolderOpen, LogOut, ServerOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CoreFatalEvent } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import { writeClipboardText } from '#shared/clipboard'
import { confirmDialogStyles } from '#shared/ui'
import styles from './App.module.scss'

export function CoreFatalDialog({ fatal }: { fatal: CoreFatalEvent | null }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'copy' | 'logs' | null>(null)
  const [feedback, setFeedback] = useState('')
  const bridge = getTermousBridge()

  const run = async (action: 'copy' | 'logs') => {
    if (!fatal || busy) return
    setBusy(action)
    setFeedback('')
    try {
      if (action === 'copy') {
        const copied = bridge?.diagnostics
          ? await bridge.diagnostics.copyStartupDiagnostics()
          : await writeClipboardText([fatal.code, fatal.message, fatal.details].filter(Boolean).join('\n')).then(() => true)
        setFeedback(t(copied ? 'app.diagnosticsCopied' : 'app.diagnosticsActionFailed'))
      } else {
        const result = await bridge?.diagnostics?.openLogsDirectory()
        if (!result?.ok) setFeedback(t('app.diagnosticsActionFailed'))
      }
    } catch {
      setFeedback(t('app.diagnosticsActionFailed'))
    } finally {
      setBusy(null)
    }
  }

  const exit = async () => {
    try {
      if (!await bridge?.windowControls?.confirmClose()) setFeedback(t('app.diagnosticsActionFailed'))
    } catch {
      setFeedback(t('app.diagnosticsActionFailed'))
    }
  }

  return (
    <Modal
      centered
      width={560}
      open={Boolean(fatal)}
      title={null}
      footer={null}
      closable={false}
      closeIcon={null}
      mask={{ closable: false }}
      keyboard={false}
      className={styles['core-fatal-modal']}
      wrapClassName={`${confirmDialogStyles['modal-wrap']} confirm-modal-wrap`}
      rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root`}
      getContainer={() => document.body}
    >
      <section className={styles['core-fatal-dialog']} aria-labelledby="core-fatal-title">
        <div className={styles['core-fatal-icon']}><ServerOff size={22} aria-hidden="true" /></div>
        <div className={styles['core-fatal-copy']}>
          <h2 id="core-fatal-title">{t(fatal?.code.startsWith('DB_') ? 'app.databaseStartupFailed' : 'app.coreFatalTitle')}</h2>
          <p>{fatal?.message}</p>
        </div>
        <details className={styles['core-fatal-details']}>
          <summary>{t('app.diagnosticsDetails')}</summary>
          <pre>{[fatal?.code, fatal?.details].filter(Boolean).join('\n\n')}</pre>
        </details>
        <div className={styles['core-fatal-actions']}>
          <Button icon={<Copy size={15} aria-hidden="true" />} loading={busy === 'copy'} disabled={busy !== null} onClick={() => void run('copy')}>
            {t('app.copyDiagnostics')}
          </Button>
          {bridge?.diagnostics && <Button icon={<FolderOpen size={15} aria-hidden="true" />} loading={busy === 'logs'} disabled={busy !== null} onClick={() => void run('logs')}>
            {t('app.openLogs')}
          </Button>}
          <Button type="primary" danger className={styles['core-fatal-exit-button']} icon={<LogOut size={16} aria-hidden="true" />} onClick={() => void exit()}>
            {t('app.exit')}
          </Button>
        </div>
        <p className={styles['core-fatal-feedback']} role="status">{feedback}</p>
      </section>
    </Modal>
  )
}
