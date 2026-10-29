import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Popover, Spin, Tooltip } from 'antd'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentLocalDirectory } from '#entities/agent'
import styles from './LocalDirectoryPicker.module.scss'

export interface LocalDirectoryPickerProps {
  sessionKey: string
  read?: () => Promise<AgentLocalDirectory>
  change?: (path: string, revision: number) => Promise<AgentLocalDirectory>
  disabled?: boolean
  running?: boolean
}

export function LocalDirectoryPicker({ sessionKey, read, change, disabled, running }: LocalDirectoryPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [directory, setDirectory] = useState<AgentLocalDirectory>()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const saving = useRef(false)
  useEffect(() => {
    const version = ++epoch.current
    setDirectory(undefined); setError(''); setBusy(false)
    if (!open || !read) return
    setBusy(true)
    void read().then(value => { if (epoch.current === version) { setDirectory(value); setPath(value.path) } },
      error => { if (epoch.current === version) setError(error instanceof Error ? error.message : t('localTools.failed')) })
      .finally(() => { if (epoch.current === version) setBusy(false) })
    return () => { epoch.current = version + 1 }
  }, [open, sessionKey, read, t])
  const save = async () => {
    if (!change || !directory || busy || saving.current || running || !path.trim()) return
    const version = epoch.current
    saving.current = true; setBusy(true); setError('')
    try {
      const value = await change(path.trim(), directory.revision)
      if (epoch.current === version) { setDirectory(value); setPath(value.path); setOpen(false) }
    } catch (error) { if (epoch.current === version) setError(error instanceof Error ? error.message : t('localTools.failed')) }
    finally { saving.current = false; if (epoch.current === version) setBusy(false) }
  }
  if (!read || !change) return null
  return <Popover open={open && !disabled} trigger="click" placement="topLeft" destroyOnHidden onOpenChange={setOpen}
    content={<div className={styles.panel}>
      <header><FolderOpen size={16} /><strong>{t('localTools.directory')}</strong></header>
      <Spin spinning={busy}><Input value={path} onChange={event => setPath(event.target.value)} onPressEnter={() => void save()}
        disabled={!directory || running || busy} aria-label={t('localTools.directory')} placeholder={t('localTools.absolutePath')} /></Spin>
      <span className={styles.hint}>{t(running ? 'localTools.runningDirectory' : 'localTools.directoryHint')}</span>
      {error && <Alert type="error" title={error} />}
      <footer><Button size="small" onClick={() => setOpen(false)}>{t('app.cancel')}</Button>
        <Button type="primary" size="small" loading={busy} disabled={!directory || running || !path.trim() || path === directory.path} onClick={() => void save()}>{t('app.save')}</Button></footer>
    </div>}>
    <Tooltip title={t('localTools.directory')}><Button type="text" disabled={disabled} icon={<FolderOpen size={15} />} aria-label={t('localTools.directory')} /></Tooltip>
  </Popover>
}
