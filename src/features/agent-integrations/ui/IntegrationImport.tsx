import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { BookOpen, FileArchive, FileJson2, FolderOpen, ScanText, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FeedbackMessage, modalSurfaceStyles } from '#shared/ui'
import type { AgentIntegrationsGateway, AgentIntegrationSource } from '#entities/agent-integrations'
import { groupSkillFiles } from '../model/skillImportFiles'
import { IntegrationImportList, type IntegrationImportItem } from './IntegrationImportList'
import { IntegrationEmptyState } from './IntegrationEmptyState'
import styles from './IntegrationImport.module.scss'

export function IntegrationImport({ kind, gateway, source, onClose, onImported }: {
  kind: 'mcp' | 'skill'; gateway: AgentIntegrationsGateway; source?: AgentIntegrationSource; onClose(): void; onImported(sources?: AgentIntegrationSource[]): void
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const [text, setText] = useState('')
  const [items, setItems] = useState<IntegrationImportItem[]>([])
  const [previewed, setPreviewed] = useState(false)
  const [operation, setOperation] = useState<'preview' | 'publish'>()
  const [error, setError] = useState('')
  const directory = useRef<HTMLInputElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const saved = useRef<AgentIntegrationSource[]>([])
  const busy = Boolean(operation)
  const hasImported = items.some(item => item.saved)
  const selectedCount = items.filter(item => item.selected && !item.saved && (item.mcp || item.skill)).length
  useEffect(() => () => controller.current?.abort(), [])

  const preview = async (files?: FileList | null) => {
    if (controller.current || hasImported || kind === 'skill' && !files?.length) return
    const abort = new AbortController(); controller.current = abort
    setOperation('preview'); setError(''); setItems([]); setPreviewed(false)
    try {
      const next: IntegrationImportItem[] = []
      if (kind === 'mcp') {
        const values = await gateway.previewMCP(text, abort.signal)
        next.push(...values.map(mcp => ({ name: mcp.name, mcp, selected: true })))
      } else if (files?.length) {
        const groups = groupSkillFiles(Array.from(files))
        if (!groups.size) throw new Error(t('extensions.missingSkill'))
        if (source && groups.size !== 1) throw new Error(t('extensions.singleUpdate'))
        for (const [name, selection] of groups) {
          abort.signal.throwIfAborted()
          try {
            const skill = await gateway.previewSkill(selection, abort.signal)
            next.push({ name: skill.manifest.name, skill, selected: true })
          } catch (cause) {
            next.push({ name, selected: false, error: cause instanceof Error ? cause.message : t('extensions.failed') })
          }
        }
      }
      if (!abort.signal.aborted) { setItems(next); setPreviewed(true) }
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t('extensions.failed'))
    } finally {
      if (controller.current === abort) controller.current = null
      if (!abort.signal.aborted) setOperation(undefined)
      if (directory.current) directory.current.value = ''
      if (zip.current) zip.current.value = ''
    }
  }

  const publish = async () => {
    if (controller.current || !selectedCount) return
    const abort = new AbortController(); controller.current = abort
    setOperation('publish'); setError('')
    let failures = 0
    try {
      for (let index = 0; index < items.length; index++) {
        abort.signal.throwIfAborted()
        const item = items[index]
        if (!item.selected || item.saved || !item.mcp && !item.skill) continue
        try {
          if (item.mcp) saved.current.push(await gateway.saveMCP(item.mcp, undefined, abort.signal))
          else if (item.skill) await gateway.publishSkill(item.skill.token, source, abort.signal)
          if (!abort.signal.aborted) setItems(current => current.map((value, i) => i === index ? { ...value, saved: true, error: undefined } : value))
        } catch (cause) {
          failures++
          if (!abort.signal.aborted) setItems(current => current.map((value, i) => i === index ? { ...value, error: cause instanceof Error ? cause.message : t('extensions.failed') } : value))
        }
      }
      if (!abort.signal.aborted) {
        if (failures) setError(t('extensions.importFailed', { count: failures }))
        else onImported(saved.current)
      }
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t('extensions.failed'))
    } finally {
      if (controller.current === abort) controller.current = null
      if (!abort.signal.aborted) setOperation(undefined)
    }
  }

  const close = () => {
    if (controller.current) return
    // 部分成功后关闭也需通知父级刷新，成功项不重新预览或再次导入。
    if (hasImported) onImported(saved.current)
    else onClose()
  }

  return <Modal open centered width={760} rootClassName={modalSurfaceStyles.root} className={styles.modal}
    title={<div className={styles.title}>{kind === 'mcp' ? <Unplug size={19} /> : <BookOpen size={19} />}<span>{t(kind === 'mcp' ? 'extensions.importMCP' : 'extensions.importSkills')}</span></div>}
    onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} destroyOnHidden
    footer={<div className={styles.footer}>
      <span className={styles.summary}>{previewed ? t('extensions.importSelection', { count: selectedCount }) : t(kind === 'mcp' ? 'extensions.importNoLaunch' : 'extensions.importNoExecution')}</span>
      <div className={styles.actions}>{(busy || selectedCount > 0 || !hasImported) && <Button disabled={busy} onClick={close}>{t(hasImported ? 'extensions.finishImport' : 'extensions.cancel')}</Button>}
        <Button type="primary" loading={operation === 'publish'} disabled={busy || !selectedCount && !hasImported} onClick={() => selectedCount ? void publish() : close()}>
          {t(!selectedCount && hasImported ? 'extensions.finishImport' : 'extensions.import')}
        </Button></div>
    </div>}>
    <div className={styles.body} aria-busy={busy}>
      <p id={`${inputId}-hint`} className={styles.description}>{t(kind === 'mcp' ? 'extensions.importMCPHint' : 'extensions.importSkillsHint')}</p>
      {kind === 'mcp' ? <section className={styles.configuration}>
        <div className={styles['section-header']}><label htmlFor={inputId}><FileJson2 size={15} />{t('extensions.jsonConfiguration')}</label>
          <Button size="small" icon={<ScanText size={14} />} loading={operation === 'preview'} disabled={busy || hasImported || !text.trim()} onClick={() => void preview()}>{t('extensions.preview')}</Button>
        </div>
        <Input.TextArea id={inputId} aria-describedby={`${inputId}-hint`} className={styles.code} value={text} onChange={event => { setText(event.target.value); setItems([]); setPreviewed(false); setError('') }}
          rows={8} placeholder={'{\n  "mcpServers": {\n    "my-mcp": {\n      "command": "npx",\n      "args": ["-y", "package-name"]\n    }\n  }\n}'}
          disabled={busy || hasImported} autoComplete="off" spellCheck={false} />
      </section> : <div className={styles['file-selection']}>
        <span className={styles['file-icon']}><BookOpen size={26} strokeWidth={1.5} /></span>
        <strong>{t('extensions.skillPackage')}</strong>
        <span>{t('extensions.skillPackageHint')}</span>
        <input hidden ref={directory} type="file" multiple {...{ webkitdirectory: '' }} onChange={event => void preview(event.target.files)} />
        <input hidden ref={zip} type="file" multiple={!source} accept=".zip" onChange={event => void preview(event.target.files)} />
        <div className={styles.actions}>
          <Button icon={<FolderOpen size={15} />} disabled={busy || hasImported} onClick={() => directory.current?.click()}>{t('extensions.chooseDirectory')}</Button>
          <Button icon={<FileArchive size={15} />} disabled={busy || hasImported} onClick={() => zip.current?.click()}>{t('extensions.chooseZIP')}</Button>
        </div>
      </div>}
      {previewed && (items.length ? <IntegrationImportList items={items} busy={busy} onChange={setItems} /> :
        <IntegrationEmptyState kind="configuration" title={t('extensions.importEmpty')} description={t('extensions.importEmptyHint')} />)}
    </div>
    {error && <FeedbackMessage type="error" title={error} onClose={() => setError('')} />}
  </Modal>
}
