import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Spin, Tooltip } from 'antd'
import { Check, FolderOpen, FolderSearch, LockKeyhole, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentLocalDirectory } from '#entities/agent'
import { getTermousBridge } from '#shared/bridge'
import { FeedbackMessage, FeedbackMessageScope, FilterPopover, uiStyles } from '#shared/ui'
import { useLocalDirectory } from '../model/useLocalDirectory'
import styles from './LocalDirectoryPicker.module.scss'

export interface LocalDirectoryPickerProps {
  sessionKey: string
  read?: () => Promise<AgentLocalDirectory>
  change?: (path: string, revision: number) => Promise<AgentLocalDirectory>
  disabled?: boolean
  active?: boolean
  running?: boolean
}

export function LocalDirectoryPicker({ sessionKey, read, change, disabled, running, active = true }: LocalDirectoryPickerProps) {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const picker = useRef<AbortController | null>(null)
  const visible = active && open && !disabled
  const bridge = getTermousBridge()?.files
  const editor = useLocalDirectory({ sessionKey, open: visible, read, change,
    loadError: t('localTools.loadFailed'), saveError: t('localTools.failed') })
  const { directory, path, setPath, loading, busy, error, setError } = editor

  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])

  useEffect(() => {
    setPicking(false)
    return () => { picker.current?.abort(); picker.current = null }
  }, [visible, sessionKey, running, read])

  const save = async () => {
    if (!running && !picking && await editor.save()) setOpen(false)
  }

  const browse = async () => {
    if (!bridge || !directory || busy || running || !visible || picker.current) return
    const controller = new AbortController()
    picker.current = controller
    setPicking(true); setError('')
    try {
      const selected = await bridge.pickDirectory()
      // 系统选择窗口无法强制关闭；会话切换、任务启动或弹层关闭后忽略晚到结果。
      if (!controller.signal.aborted && selected[0]) setPath(selected[0])
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('localTools.chooseFailed'))
    } finally {
      if (picker.current === controller) { picker.current = null; setPicking(false) }
    }
  }

  if (!read || !change) return null
  return <FeedbackMessageScope scope={`session-directory:${sessionKey}`} active={visible}>
    {error && <FeedbackMessage type="error" title={t(directory ? 'localTools.failed' : 'localTools.loadFailed')}
      description={error} onClose={() => setError('')} />}
    <FilterPopover open={visible} placement="topLeft" destroyOnHidden onOpenChange={setOpen}
      content={<section className={styles.panel} aria-label={t('localTools.workspace')}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}>
        <header className={styles.heading}>
          <span className={styles.icon}><FolderOpen size={18} /></span>
          <strong>{t('localTools.workspace')}</strong>
          <Button type="text" className={styles.close} icon={<X size={15} />} aria-label={t('app.close')} onClick={() => setOpen(false)} />
        </header>
        {loading ? <div className={styles.empty} role="status"><Spin size="small" /><span>{t('app.loading')}</span></div>
          : !directory ? <div className={styles.empty}><FolderSearch size={24} strokeWidth={1.4} /><span>{t('localTools.loadFailed')}</span>
            <Button size="small" className={uiStyles['secondary-button']} onClick={editor.refresh}>{t('extensions.preferences.retry')}</Button></div>
            : <>
              <div className={`${uiStyles.field} ${styles.field}`}>
                <div className={styles.label}><label htmlFor={id}>{t('localTools.directory')}</label>
                  <span>{t(directory.managed ? 'localTools.managedDirectory' : 'localTools.customDirectory')}</span></div>
                <Input.TextArea id={id} className={styles.path} value={path} rows={2} spellCheck={false}
                  onChange={event => setPath(event.target.value)} disabled={running || busy || picking}
                  aria-describedby={`${id}-hint`} placeholder={t('localTools.absolutePath')}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                      event.preventDefault(); void save()
                    }
                  }} />
                <div className={styles['directory-tools']}>
                  <span className={styles.hint} id={`${id}-hint`}>{t('localTools.directoryHint')}</span>
                  {bridge && <Button size="small" type="text" className={uiStyles['inline-management-action']}
                    icon={<FolderSearch size={14} />} disabled={running || busy} loading={picking} onClick={() => void browse()}>{t('extensions.chooseDirectory')}</Button>}
                </div>
              </div>
              <footer className={styles.footer}>
                {running ? <span className={styles.lock}><LockKeyhole size={13} />{t('localTools.runningDirectory')}</span> : <>
                  <Button size="small" className={uiStyles['secondary-button']} onClick={() => setOpen(false)}>{t('app.cancel')}</Button>
                  <Button size="small" className={uiStyles['primary-button']} icon={<Check size={13} />} loading={busy}
                    disabled={picking || !path.trim() || path.trim() === directory.path} onClick={() => void save()}>{t('localTools.applyDirectory')}</Button>
                </>}
              </footer>
            </>}
      </section>}>
      <Tooltip title={visible ? undefined : t('localTools.workspace')}>
        <Button type="text" className={uiStyles['icon-action']} data-tour="agent-local-workspace" disabled={disabled || !active}
          icon={<FolderOpen size={15} />} aria-label={t('localTools.workspace')} aria-expanded={visible} />
      </Tooltip>
    </FilterPopover>
  </FeedbackMessageScope>
}
