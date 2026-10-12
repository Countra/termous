import { Button, Tooltip } from 'antd'
import { Check, Copy, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopSharePath({ path }: { path: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setCopied(false); setFailed(false) }, [path])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try { await navigator.clipboard.writeText(path); setCopied(true); setFailed(false) }
    catch { setFailed(true) }
  }
  return <div className={styles.share}>
    <Monitor size={17} />
    <div><span>{t('remoteDesktop.files.targetLocation')}</span><code>{path}</code>
      {failed && <span role="alert">{t('remoteDesktop.files.copyFailed')}</span>}
    </div>
    <Tooltip title={t(`remoteDesktop.files.${copied ? 'copied' : 'copyPath'}`)}><Button type="text" size="small" icon={copied ? <Check size={15} /> : <Copy size={15} />} aria-label={t('remoteDesktop.files.copyPath')} onClick={() => void copy()} /></Tooltip>
  </div>
}
