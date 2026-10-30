import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Space, Tag } from 'antd'
import { FolderOpen, FileArchive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { modalSurfaceStyles } from '#shared/ui'
import type { AgentIntegrationsGateway, AgentIntegrationSource, MCPIntegrationInput, SkillImportPreview } from '#entities/agent-integrations'
import styles from './AssistantExtensions.module.scss'
import { groupSkillFiles } from '../model/skillImportFiles'

export function IntegrationImport({ kind, gateway, source, onClose, onImported }: {
  kind: 'mcp' | 'skill'; gateway: AgentIntegrationsGateway; source?: AgentIntegrationSource; onClose(): void; onImported(sources?: AgentIntegrationSource[]): void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [items, setItems] = useState<Array<{name: string; mcp?: MCPIntegrationInput; skill?: SkillImportPreview; selected: boolean; error?: string; saved?: boolean}>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const directory = useRef<HTMLInputElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  const controller=useRef<AbortController | null>(null)
  const saved = useRef<AgentIntegrationSource[]>([])
  useEffect(()=>()=>controller.current?.abort(),[])
  const preview = async (files?: FileList | null) => {
    if (controller.current) return
    const abort=new AbortController();controller.current=abort
    setBusy(true); setError('')
    try {
      if (kind === 'mcp') {
        const values=await gateway.previewMCP(text,abort.signal)
        if (!abort.signal.aborted) setItems(values.map(mcp => ({name: mcp.name, mcp, selected: true})))
      }
      else if (files?.length) {
        const groups = groupSkillFiles(Array.from(files))
        if (!groups.size) throw new Error(t('extensions.missingSkill'))
        if (source && groups.size!==1) throw new Error(t('extensions.singleUpdate'))
        const next: typeof items = []
        for (const [name, selection] of groups) {
          abort.signal.throwIfAborted()
          try { const skill = await gateway.previewSkill(selection,abort.signal); next.push({name: skill.manifest.name, skill, selected: true}) }
          catch (error) { next.push({name, selected: false, error: error instanceof Error ? error.message : t('extensions.failed')}) }
        }
        if (!abort.signal.aborted) setItems(next)
      }
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t('extensions.failed')) }
    finally {
      if (controller.current === abort) controller.current = null
      if (!abort.signal.aborted) setBusy(false)
      if (directory.current) directory.current.value=''
      if (zip.current) zip.current.value=''
    }
  }
  const publish = async () => {
    if (controller.current) return
    const abort=new AbortController();controller.current=abort
    setBusy(true); setError('')
    let failed = false
    const savedSources: AgentIntegrationSource[] = [...saved.current]
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      if (abort.signal.aborted) return
      if (!item.selected || item.saved) continue
      try {
        if (item.mcp) savedSources.push(await gateway.saveMCP(item.mcp,undefined,abort.signal))
        else if (item.skill) await gateway.publishSkill(item.skill.token, source,abort.signal)
        if (!abort.signal.aborted) setItems(current => current.map((value, i) => i === index ? {...value, saved:true,error:undefined} : value))
      } catch (error) {
        failed = true
        if (!abort.signal.aborted) setItems(current => current.map((value, i) => i === index ? {...value,error:error instanceof Error ? error.message : t('extensions.failed')} : value))
      }
    }
    if (controller.current === abort) controller.current = null
    if (abort.signal.aborted) return
    setBusy(false)
    saved.current = savedSources
    if (!failed) onImported(savedSources)
  }
  return <Modal open centered width={640} rootClassName={modalSurfaceStyles.root} title={t(kind === 'mcp' ? 'extensions.importMCP' : 'extensions.importSkills')}
    onCancel={onClose} closable={!busy} mask={{closable:!busy}} destroyOnHidden footer={<Space>
      <Button disabled={busy} onClick={onClose}>{t('extensions.cancel')}</Button>
      <Button type="primary" loading={busy} disabled={!items.some(item => item.selected && !item.saved && (item.mcp || item.skill))} onClick={() => void publish()}>{t('extensions.import')}</Button>
    </Space>}>
    <div className={styles.importer}>
      {kind === 'mcp' ? <><Input.TextArea value={text} onChange={event => { setText(event.target.value); setItems([]); saved.current = [] }} rows={7} placeholder={'{"mcpServers": {}}'} disabled={busy} spellCheck={false} />
        <Button loading={busy} disabled={!text.trim()} onClick={() => void preview()}>{t('extensions.preview')}</Button></> : <>
        <input hidden ref={directory} type="file" multiple {...{webkitdirectory: ''}} onChange={event => void preview(event.target.files)} />
        <input hidden ref={zip} type="file" multiple={!source} accept=".zip" onChange={event => void preview(event.target.files)} />
        <Space><Button icon={<FolderOpen size={15} />} disabled={busy} onClick={() => directory.current?.click()}>{t('extensions.chooseDirectory')}</Button>
          <Button icon={<FileArchive size={15} />} disabled={busy} onClick={() => zip.current?.click()}>{t('extensions.chooseZIP')}</Button></Space>
        <span className={styles.muted}>{t('extensions.scriptsReadOnly')}</span>
      </>}
      <ul className={styles['import-list']}>{items.map((item, index) => <li key={`${index}:${item.name}`} className={styles['import-item']}>
        <Checkbox checked={item.selected} disabled={busy || !item.mcp && !item.skill || item.saved} onChange={event => setItems(current => current.map((value,i) => i === index ? {...value, selected:event.target.checked} : value))}>{item.name}</Checkbox>
        {item.saved && <Tag color="success">{t('extensions.imported')}</Tag>}
        {item.skill && <span className={styles.muted}>{item.skill.manifest.description} · {t('extensions.fileCount',{count:item.skill.manifest.files.length})}</span>}
        {item.mcp && <code>{item.mcp.mcp.transport === 'stdio' ? [item.mcp.mcp.command,...item.mcp.mcp.args ?? []].join(' ') : item.mcp.mcp.url}</code>}
        {item.error && <Alert type="error" title={item.error} />}
      </li>)}</ul>
      {error && <Alert type="error" title={error} showIcon />}
    </div>
  </Modal>
}
