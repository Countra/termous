import { useState } from 'react'
import { Alert, Button, Checkbox } from 'antd'
import { ClipboardCopy, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './AccountMFA.module.scss'

export function AccountMFACodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  const content = codes.join('\n')
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); setError(false) } catch { setError(true) }
  }
  const download = () => {
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([`Termous 2FA backup codes\n\n${content}\n`], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'termous-2fa-backup-codes.txt'
      link.click(); setError(false)
    } catch { setError(true) } finally { if (url) URL.revokeObjectURL(url) }
  }
  return <div className={styles['backup-stage']}>
    <Alert type="warning" showIcon title={t('cloud.mfa.saveCodes')} description={t('cloud.mfa.saveCodesHint')} />
    <ol className={styles.codes} aria-label={t('cloud.mfa.backupCodes')}>{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
    {error ? <Alert type="error" showIcon title={t('cloud.mfa.exportFailed')} /> : null}
    <div className={styles.actions}>
      <Button icon={<ClipboardCopy size={14} />} onClick={() => void copy()}>{t(copied ? 'cloud.mfa.copied' : 'cloud.copy')}</Button>
      <Button icon={<Download size={14} />} onClick={download}>{t('cloud.mfa.downloadCodes')}</Button>
    </div>
    <Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)}>{t('cloud.mfa.codesSaved')}</Checkbox>
    <Button type="primary" disabled={!saved} onClick={onDone}>{t('cloud.mfa.done')}</Button>
  </div>
}
