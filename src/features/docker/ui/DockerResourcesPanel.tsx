import { Alert, Button, Input, Tooltip } from 'antd'
import { ArrowLeft, ArrowRight, ChevronRight, HardDrive, Layers, Network, Plus, RefreshCw, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerResourceKind } from '#entities/docker'
import { uiStyles, WorkspaceDetectionLoading, WorkspaceEmptyState } from '#shared/ui'
import { formatDate } from '#shared/format'
import type { DockerGateway, DockerSessionContext } from '../model/contracts'
import { useDockerResources } from '../model/useDockerResources'
import { DockerResourceDetails } from './DockerResourceDetails'
import { DockerResourceDialog, type DockerResourceIntent } from './DockerResourceDialog'
import styles from './DockerResources.module.scss'

export function DockerResourcesPanel({ api, session, kind, enabled, invalidationRevision, onContainersChanged }: {
  api: DockerGateway
  session: DockerSessionContext | null
  kind: DockerResourceKind
  enabled: boolean
  invalidationRevision?: number
  onContainersChanged?: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const text = (key: string) => t(`workbench.docker.resources.${key}`)
  const resources = useDockerResources(api, session, kind, enabled, invalidationRevision, onContainersChanged)
  const { search, setSearch, query: filter } = resources
  const scope = `${session?.id}:${session?.status}:${kind}:${enabled}`
  const [dialog, setDialog] = useState<{ scope: string; intent: DockerResourceIntent } | null>(null)
  const intent = dialog?.scope === scope ? dialog.intent : null
  const setIntent = (next: DockerResourceIntent | null) => setDialog(next ? { scope, intent: next } : null)
  const scopeRef = useRef(scope)
  const intentRef = useRef(intent)
  scopeRef.current = scope
  intentRef.current = intent
  useEffect(() => { setDialog(null) }, [api, scope, resources.capability?.available])
  const Icon = kind === 'images' ? Layers : kind === 'volumes' ? HardDrive : Network

  const openAction = (next: DockerResourceIntent) => {
    if (!enabled || resources.busy) return
    resources.clearActionError()
    setIntent(next)
  }
  const submit = async (value: string, internal: boolean) => {
    const current = intent
    if (!current || scopeRef.current !== scope || !enabled || resources.busy) return
    let success: boolean
    switch (current.action) {
      case 'create': success = await resources.create({ name: value, ...(kind === 'networks' ? { internal } : {}) }); break
      case 'tag': success = await resources.action(current.resource.id, { action: 'tag', tag: value }); break
      case 'connect': success = await resources.action(current.resource.id, { action: 'connect', container: value }); break
      case 'disconnect': success = await resources.action(current.resource.id, { action: 'disconnect', container: current.container }); break
      case 'remove': success = await resources.action(current.resource.id, { action: 'remove' }); break
    }
    if (!success || scopeRef.current !== scope) return
    // 状态层负责更新缓存；切走再返回时不抢占用户正在查看的详情。
    if (intentRef.current !== current) return
    setIntent(null)
    if (current.action === 'create') void resources.select('')
  }
  const applyFilter = (value: string) => {
    setSearch(value)
    void resources.refresh(value, 0)
  }

  if (!resources.supported) return <WorkspaceEmptyState icon={<Icon size={20} />} title={t('workbench.docker.emptyTitle')} description={t('workbench.docker.emptyHint')} />
  return <section className={styles.resources} aria-label={text(kind)}>
    <header className={styles.toolbar}>
      {resources.selectedRef ? <Button className={styles.back} type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => void resources.select('')}>{t('workbench.docker.backToList')}</Button>
        : <div className={styles.heading}><span className={styles['heading-icon']}><Icon size={17} aria-hidden="true" /></span><strong>{text(kind)}</strong>
          {resources.list && <span className={styles.count}>{resources.list.filtered}</span>}
        </div>}
      <div className={styles['toolbar-actions']}>
        {kind !== 'images' && !resources.selectedRef && resources.capability?.available && <Button size="small" type="text" disabled={!enabled || resources.busy} icon={<Plus size={14} />} onClick={() => openAction({ action: 'create' })}>{text(`create_${kind}`)}</Button>}
        <Tooltip title={t('workbench.docker.refresh')}><Button type="text" size="small" className={styles.refresh} aria-label={t('workbench.docker.refresh')}
          loading={resources.loading || resources.detailLoading} disabled={!enabled || resources.busy}
          icon={<RefreshCw size={14} />} onClick={() => { void resources.refresh(undefined, undefined, true); if (resources.selectedRef) void resources.select(resources.selectedRef, true) }} /></Tooltip>
      </div>
    </header>
    {!resources.selectedRef && <Input aria-label={text('search')} value={search} allowClear maxLength={256}
      className={`${uiStyles['search-input']} ${styles.search}`} variant="borderless" prefix={<Search size={14} />} placeholder={text('search')}
      onChange={(event) => { setSearch(event.target.value); if (!event.target.value) applyFilter('') }}
      onPressEnter={() => applyFilter(search)} />}
    {resources.error && <Alert type="error" showIcon title={text('loadFailed')} description={resources.error} />}
    {resources.actionError && !intent && <Alert type="error" showIcon title={resources.actionError} description={text('failureHint')} />}
    <div className={styles.content}>
      {!resources.capability && !resources.error ? <WorkspaceDetectionLoading icon={<Icon size={15} />} label={t('workbench.docker.detecting')} /> : null}
      {resources.capability && !resources.capability.available ? <WorkspaceEmptyState icon={<Icon size={20} />} title={t(`workbench.docker.status.${resources.capability.status}`)} description={resources.capability.message} /> : null}
      {resources.selectedRef ? <>
        {resources.detailLoading && !resources.detail && <WorkspaceDetectionLoading icon={<Icon size={15} />} label={t('workbench.docker.detailLoading')} />}
        {resources.detailError && <Alert type="error" title={text('loadFailed')} description={resources.detailError} />}
        {resources.detail && <DockerResourceDetails detail={resources.detail} busy={resources.busy || !enabled || resources.detailLoading || Boolean(resources.detailError)} onAction={openAction} />}
      </> : <>
        {resources.loading && resources.capability?.available && !resources.list && <WorkspaceDetectionLoading icon={<Icon size={15} />} label={text('loading')} />}
        {resources.list?.items.length === 0 && !resources.loading && <WorkspaceEmptyState icon={<Icon size={20} />} title={text(filter ? 'noMatches' : 'empty')} description={text(filter ? 'searchHint' : `empty_${kind}`)} />}
        <div className={styles.list}>
          {resources.list?.items.map((item) => <button type="button" className={styles.row} key={item.id} disabled={!enabled || resources.busy} onClick={() => void resources.select(item.id)}>
            <span className={styles['resource-icon']}><Icon size={17} aria-hidden="true" /></span>
            <span className={styles['row-copy']}><strong title={item.name}>{item.name}</strong>
              <span>{kind === 'images' ? `${item.id.replace(/^sha256:/, '').slice(0, 12)}${(item.tags?.length ?? 0) > 1 ? ` · ${t('workbench.docker.resources.tagCount', { count: item.tags?.length })}` : ''}` : [...new Set([item.driver, item.scope].filter(Boolean))].join(' · ')}</span>
            </span>
            <span className={styles['row-meta']}>{kind === 'images' && <span>{item.size}</span>}<ChevronRight size={14} aria-hidden="true" /></span>
          </button>)}
        </div>
      </>}
    </div>
    {!resources.selectedRef && resources.list && <footer className={styles.pagination}>
      <span title={formatDate(resources.list.collected_at)}>{t('workbench.docker.resources.pageSummary', { start: resources.list.items.length ? resources.list.offset + 1 : 0, end: resources.list.offset + resources.list.items.length, total: resources.list.filtered })}</span>
      <div><Button type="text" size="small" aria-label={text('previous')} icon={<ArrowLeft size={14} />} disabled={resources.loading || resources.list.offset === 0} onClick={() => void resources.refresh(filter, Math.max(0, resources.list!.offset - resources.list!.limit))} />
        <Button type="text" size="small" aria-label={text('next')} icon={<ArrowRight size={14} />} disabled={resources.loading || resources.list.offset + resources.list.items.length >= resources.list.filtered} onClick={() => void resources.refresh(filter, resources.list!.offset + resources.list!.limit)} /></div>
    </footer>}
    {enabled && intent && <DockerResourceDialog intent={intent} kind={kind} busy={resources.busy} error={resources.actionError} onCancel={() => setIntent(null)} onSubmit={(value, internal) => { void submit(value, internal) }} />}
  </section>
}
