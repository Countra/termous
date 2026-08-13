import { App, Button, Input, Popconfirm, Segmented, Switch, Tooltip } from 'antd'
import {
  CalendarClock,
  FileCode2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrontabJob, CrontabSnapshot } from '#entities/crontab'
import { TermousApiError } from '#shared/api'
import {
  confirmDialogStyles,
  termousNotificationClassName,
  termousPopconfirmProps,
  uiStyles,
  WorkspaceDetectionLoading,
  WorkspaceEmptyState,
} from '#shared/ui'
import type { ThemeMode } from '#shared/theme'
import type { CrontabGateway, CrontabSessionContext } from '../model/contracts'
import { findReloadedCrontabJob } from '../model/editorRecovery'
import { isCrontabWriteUncertainError } from '../model/mutationErrors'
import { requireCrontabSourceSnapshot } from '../model/sourceSnapshot'
import { useSessionCrontab } from '../model/useSessionCrontab'
import { CrontabJobModal, type CrontabJobSubmitValue } from './CrontabJobModal'
import { CrontabRawEditorModal } from './CrontabRawEditorModal'
import styles from './CrontabPanel.module.scss'

export interface CrontabPanelProps {
  api: CrontabGateway
  session: CrontabSessionContext | null
  enabled: boolean
  theme: ThemeMode
}

type CrontabFilter = 'all' | 'enabled' | 'disabled'
type CrontabEditorBlock = 'conflict' | 'uncertain' | 'uncertain_create' | 'target_changed' | ''

export function CrontabPanel({ api, session, enabled, theme }: CrontabPanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = App.useApp()
  const crontab = useSessionCrontab({ api, session, enabled })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CrontabFilter>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<CrontabJob | null>(null)
  const [mutationJobId, setMutationJobId] = useState('')
  const [editorSessionId, setEditorSessionId] = useState('')
  const [editorBlock, setEditorBlock] = useState<CrontabEditorBlock>('')
  const [editorReloading, setEditorReloading] = useState(false)
  const [editorRecoveryError, setEditorRecoveryError] = useState('')
  const [rawSnapshot, setRawSnapshot] = useState<CrontabSnapshot | null>(null)
  const [loadingRaw, setLoadingRaw] = useState(false)
  const [deleteConfirmJobId, setDeleteConfirmJobId] = useState('')
  const rawEntryConfirmRef = useRef<ReturnType<typeof modal.confirm> | null>(null)
  const editorGenerationRef = useRef(0)
  const activeSessionIdRef = useRef(session?.id ?? '')
  activeSessionIdRef.current = session?.id ?? ''
  const snapshot = crontab.snapshot
  const capability = crontab.capability
  const busy = Boolean(crontab.mutation)

  useEffect(() => {
    editorGenerationRef.current += 1
    rawEntryConfirmRef.current?.destroy()
    rawEntryConfirmRef.current = null
    setQuery('')
    setFilter('all')
    setEditorOpen(false)
    setEditingJob(null)
    setMutationJobId('')
    setEditorSessionId('')
    setEditorBlock('')
    setEditorReloading(false)
    setEditorRecoveryError('')
    setRawSnapshot(null)
    setLoadingRaw(false)
    setDeleteConfirmJobId('')
  }, [session?.id, session?.status])

  useEffect(() => {
    if (enabled) {
      return
    }
    editorGenerationRef.current += 1
    rawEntryConfirmRef.current?.destroy()
    rawEntryConfirmRef.current = null
    setEditorOpen(false)
    setEditingJob(null)
    setMutationJobId('')
    setEditorSessionId('')
    setEditorBlock('')
    setEditorReloading(false)
    setEditorRecoveryError('')
    setRawSnapshot(null)
    setLoadingRaw(false)
    setDeleteConfirmJobId('')
  }, [enabled])

  const jobs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return (snapshot?.jobs ?? []).filter((job) => {
      if (filter === 'enabled' && !job.enabled) {
        return false
      }
      if (filter === 'disabled' && job.enabled) {
        return false
      }
      return !normalizedQuery
        || job.expression.toLocaleLowerCase().includes(normalizedQuery)
        || job.command.toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [filter, query, snapshot?.jobs])

  const notifyError = (error: unknown, fallbackKey: string) => {
    notification.error({
      title: t(fallbackKey),
      description: error instanceof Error ? error.message : undefined,
      duration: 4,
      role: 'alert',
      className: termousNotificationClassName,
    })
  }

  const handleMutationStateError = async (error: unknown, preserveEditor = false) => {
    if (!(error instanceof TermousApiError)) {
      return false
    }
    const uncertain = isCrontabWriteUncertainError(error)
    if (!uncertain && error.code !== 'CRONTAB_CONFLICT') {
      return false
    }
    notification.warning({
      title: t(uncertain ? 'workbench.crontab.uncertainTitle' : 'workbench.crontab.conflictTitle'),
      description: t(uncertain ? 'workbench.crontab.uncertainHint' : 'workbench.crontab.conflictHint'),
      duration: 4,
      role: 'alert',
      className: termousNotificationClassName,
    })
    if (preserveEditor) {
      setEditorBlock(uncertain ? 'uncertain' : 'conflict')
      setEditorRecoveryError('')
    } else {
      await crontab.refresh().catch(() => undefined)
    }
    return true
  }

  const saveJob = async (value: CrontabJobSubmitValue) => {
    const targetSessionId = session?.id ?? ''
    try {
      if (editingJob) {
        if (!mutationJobId) {
          throw new TermousApiError('定时任务编辑目标已经失效', 'CRONTAB_JOB_NOT_FOUND', 409)
        }
        await crontab.updateJob(mutationJobId, value)
      } else {
        await crontab.createJob(value)
      }
      if (activeSessionIdRef.current !== targetSessionId) {
        return
      }
      notification.success({
        title: t(editingJob ? 'workbench.crontab.updateSuccess' : 'workbench.crontab.createSuccess'),
        duration: 2.5,
        role: 'status',
        className: termousNotificationClassName,
      })
      setEditorOpen(false)
      editorGenerationRef.current += 1
      setEditingJob(null)
      setMutationJobId('')
      setEditorSessionId('')
      setEditorBlock('')
      setEditorRecoveryError('')
    } catch (error) {
      if (activeSessionIdRef.current !== targetSessionId) {
        return
      }
      if (!await handleMutationStateError(error, true)) {
        notifyError(error, editingJob ? 'workbench.crontab.updateFailed' : 'workbench.crontab.createFailed')
      }
    }
  }

  const reloadJobEditor = async () => {
    if (!editorBlock || editorReloading) {
      return
    }
    const targetSessionId = session?.id ?? ''
    const targetGeneration = editorGenerationRef.current
    const targetJob = editingJob
    const targetBlock = editorBlock
    setEditorReloading(true)
    setEditorRecoveryError('')
    try {
      const latest = await crontab.refresh()
      if (
        !latest
        || activeSessionIdRef.current !== targetSessionId
        || editorGenerationRef.current !== targetGeneration
      ) {
        return
      }
      if (!targetJob) {
        if (targetBlock === 'uncertain' || targetBlock === 'uncertain_create') {
          setEditorBlock('uncertain_create')
          setEditorRecoveryError(t('workbench.crontab.editor.uncertainCreate'))
        } else {
          setEditorBlock('')
        }
        return
      }
      const reloadedJob = findReloadedCrontabJob(targetJob, latest.jobs)
      if (!reloadedJob) {
        setEditorBlock('target_changed')
        setEditorRecoveryError(t('workbench.crontab.editor.targetChanged'))
        return
      }
      setMutationJobId(reloadedJob.id)
      setEditorBlock('')
    } catch (error) {
      if (
        activeSessionIdRef.current === targetSessionId
        && editorGenerationRef.current === targetGeneration
      ) {
        setEditorRecoveryError(error instanceof Error
          ? error.message
          : t('workbench.crontab.editor.reloadFailed'))
      }
    } finally {
      if (
        activeSessionIdRef.current === targetSessionId
        && editorGenerationRef.current === targetGeneration
      ) {
        setEditorReloading(false)
      }
    }
  }

  const toggleJob = async (job: CrontabJob, checked: boolean) => {
    const targetSessionId = session?.id ?? ''
    try {
      await crontab.updateJob(job.id, {
        schedule: job.expression,
        command: job.command,
        enabled: checked,
      }, 'toggle')
      if (activeSessionIdRef.current !== targetSessionId) {
        return
      }
      notification.success({
        title: t(checked ? 'workbench.crontab.enableSuccess' : 'workbench.crontab.disableSuccess'),
        duration: 2,
        role: 'status',
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (activeSessionIdRef.current !== targetSessionId) {
        return
      }
      if (!await handleMutationStateError(error)) {
        notifyError(error, 'workbench.crontab.toggleFailed')
      }
    }
  }

  const deleteJob = async (job: CrontabJob) => {
    const targetSessionId = session?.id ?? ''
    try {
      await crontab.deleteJob(job.id)
      if (activeSessionIdRef.current !== targetSessionId) {
        return
      }
      notification.success({
        title: t('workbench.crontab.deleteSuccess'),
        duration: 2.5,
        role: 'status',
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (activeSessionIdRef.current !== targetSessionId) {
        return
      }
      if (!await handleMutationStateError(error)) {
        notifyError(error, 'workbench.crontab.deleteFailed')
      }
    } finally {
      if (activeSessionIdRef.current === targetSessionId) {
        setDeleteConfirmJobId('')
      }
    }
  }

  const openRawEditor = async () => {
    if (!capability?.writable || loadingRaw || busy) {
      return
    }
    const targetSessionId = session?.id ?? ''
    setLoadingRaw(true)
    try {
      const source = await crontab.loadSource(true)
      if (!source || activeSessionIdRef.current !== targetSessionId) {
        return
      }
      setRawSnapshot(requireCrontabSourceSnapshot(
        source,
        t('workbench.crontab.raw.contentUnavailable'),
      ))
    } catch (error) {
      if (activeSessionIdRef.current === targetSessionId) {
        notifyError(error, 'workbench.crontab.raw.loadFailed')
      }
    } finally {
      if (activeSessionIdRef.current === targetSessionId) {
        setLoadingRaw(false)
      }
    }
  }

  const requestOpenRawEditor = () => {
    if (!capability?.writable || loadingRaw || busy || rawEntryConfirmRef.current) {
      return
    }
    rawEntryConfirmRef.current = modal.confirm({
      centered: true,
      className: confirmDialogStyles.modal,
      rootClassName: confirmDialogStyles['modal-wrap'],
      title: t('workbench.crontab.raw.openConfirmTitle'),
      content: t('workbench.crontab.raw.openConfirmContent', { username: snapshot?.username ?? '' }),
      okText: t('workbench.crontab.raw.openConfirmAction'),
      cancelText: t('app.cancel'),
      onOk: openRawEditor,
      afterClose: () => {
        rawEntryConfirmRef.current = null
      },
    })
  }

  const reloadRawEditor = async () => {
    const targetSessionId = session?.id ?? ''
    const source = await crontab.loadSource()
    if (!source || activeSessionIdRef.current !== targetSessionId) {
      return null
    }
    const nextSnapshot = requireCrontabSourceSnapshot(
      source,
      t('workbench.crontab.raw.contentUnavailable'),
    )
    setRawSnapshot((current) => (
      current?.session_id === nextSnapshot.session_id ? nextSnapshot : current
    ))
    return nextSnapshot
  }

  const refreshCrontab = async () => {
    const targetSessionId = session?.id ?? ''
    try {
      await crontab.refresh()
    } catch (error) {
      if (activeSessionIdRef.current === targetSessionId) {
        notifyError(error, 'workbench.crontab.loadFailed')
      }
    }
  }

  if (!crontab.supported) {
    return (
      <WorkspaceEmptyState
        icon={<CalendarClock size={21} />}
        title={t('workbench.crontab.emptyTitle')}
        description={t('workbench.crontab.emptyHint')}
      />
    )
  }

  if (crontab.loading && !capability) {
    return <WorkspaceDetectionLoading icon={<CalendarClock size={16} />} label={t('workbench.crontab.detecting')} />
  }

  if (crontab.errorMessage && !capability) {
    return (
      <CrontabUnavailable
        title={t('workbench.crontab.loadFailed')}
        description={crontab.errorMessage}
        loading={crontab.loading}
        onRetry={() => void refreshCrontab()}
      />
    )
  }

  if (capability && (!capability.available || !capability.readable)) {
    return (
      <CrontabUnavailable
        title={t(`workbench.crontab.capability.${capability.status}`)}
        description={t('workbench.crontab.unavailableHint')}
        loading={crontab.loading}
        onRetry={() => void refreshCrontab()}
      />
    )
  }

  if (!snapshot) {
    return <WorkspaceDetectionLoading icon={<CalendarClock size={16} />} label={t('workbench.crontab.loading')} />
  }

  return (
    <section className={styles.root} data-crontab-panel>
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles['heading-icon']}><CalendarClock size={16} /></span>
          <div>
            <strong>{t('workbench.crontab.title')}</strong>
            <span>{t('workbench.crontab.summary', { username: snapshot.username, count: snapshot.jobs.length })}</span>
          </div>
        </div>
        <div className={styles['header-actions']}>
          <Tooltip title={t('workbench.crontab.raw.open')}>
            <Button
              type="text"
              className={styles['icon-button']}
              aria-label={t('workbench.crontab.raw.open')}
              icon={<FileCode2 size={14} />}
              loading={loadingRaw}
              disabled={!capability?.writable || busy}
              onClick={requestOpenRawEditor}
            />
          </Tooltip>
          <Tooltip title={t('workbench.crontab.refresh')}>
            <Button
              type="text"
              className={styles['icon-button']}
              aria-label={t('workbench.crontab.refresh')}
              icon={<RefreshCw size={14} />}
              loading={crontab.loading}
              disabled={busy}
              onClick={() => void refreshCrontab()}
            />
          </Tooltip>
          <Tooltip title={capability?.writable ? t('workbench.crontab.create') : t('workbench.crontab.readOnly')}>
            <Button
              type="primary"
              className={styles['create-button']}
              aria-label={t('workbench.crontab.create')}
              icon={<Plus size={14} />}
              disabled={!capability?.writable || busy}
              onClick={() => {
                editorGenerationRef.current += 1
                setEditingJob(null)
                setMutationJobId('')
                setEditorSessionId(session?.id ?? '')
                setEditorBlock('')
                setEditorRecoveryError('')
                setEditorOpen(true)
              }}
            />
          </Tooltip>
        </div>
      </div>

      {!capability?.writable ? (
        <div className={styles['read-only-bar']}>
          <TriangleAlert size={13} />
          <span>{t('workbench.crontab.readOnlyHint')}</span>
        </div>
      ) : null}

      {snapshot.unmanaged_line_count > 0 ? (
        <div className={styles['snapshot-note']}>
          <TriangleAlert size={13} />
          <span>{t('workbench.crontab.unmanagedLines', { count: snapshot.unmanaged_line_count })}</span>
        </div>
      ) : null}

      <div className={styles.controls}>
        <Input
          id="crontab-search"
          name="crontab-search"
          className={`host-search-input ${uiStyles['search-input']} termous-search-input ${styles.search}`}
          value={query}
          allowClear
          variant="borderless"
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t('workbench.crontab.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Segmented
          block
          size="small"
          value={filter}
          options={([
            ['all', 'filterAll'],
            ['enabled', 'filterEnabled'],
            ['disabled', 'filterDisabled'],
          ] as const).map(([value, key]) => ({ value, label: t(`workbench.crontab.${key}`) }))}
          onChange={(value) => setFilter(value as CrontabFilter)}
        />
      </div>

      <div className={styles.list} role="list" aria-label={t('workbench.crontab.listLabel')}>
        {jobs.length ? jobs.map((job) => (
          <CrontabJobRow
            key={job.id}
            job={job}
            writable={Boolean(capability?.writable)}
            busy={busy}
            deleting={crontab.mutation === 'delete' && deleteConfirmJobId === job.id}
            deleteConfirmOpen={deleteConfirmJobId === job.id}
            onDeleteConfirmOpenChange={(open) => setDeleteConfirmJobId(open ? job.id : '')}
            onEdit={() => {
              editorGenerationRef.current += 1
              setEditingJob(job)
              setMutationJobId(job.id)
              setEditorSessionId(session?.id ?? '')
              setEditorBlock('')
              setEditorRecoveryError('')
              setEditorOpen(true)
            }}
            onToggle={(checked) => void toggleJob(job, checked)}
            onDelete={() => deleteJob(job)}
          />
        )) : (
          <div className={styles.empty}>
            <CalendarClock size={22} />
            <strong>{query || filter !== 'all' ? t('workbench.crontab.noResults') : t('workbench.crontab.noJobs')}</strong>
            <span>{query || filter !== 'all' ? t('workbench.crontab.noResultsHint') : t('workbench.crontab.noJobsHint')}</span>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <span>{snapshot.collected_at ? t('workbench.crontab.collectedAt', { time: formatTime(snapshot.collected_at) }) : t('workbench.crontab.updatedNever')}</span>
        <code>{snapshot.revision.slice(0, 8)}</code>
      </div>

      <CrontabJobModal
        open={editorOpen && enabled && editorSessionId === (session?.id ?? '')}
        job={editingJob}
        writable={Boolean(capability?.writable)}
        busy={crontab.mutation === 'create' || crontab.mutation === 'update'}
        blocked={Boolean(editorBlock)}
        blockMessage={editorRecoveryError || t(
          editorBlock === 'uncertain'
            ? 'workbench.crontab.editor.uncertain'
            : editorBlock === 'uncertain_create'
              ? 'workbench.crontab.editor.uncertainCreate'
              : editorBlock === 'target_changed'
                ? 'workbench.crontab.editor.targetChanged'
                : 'workbench.crontab.editor.conflict',
        )}
        reloading={editorReloading}
        onCancel={() => {
          if (!busy && !editorReloading) {
            editorGenerationRef.current += 1
            setEditorOpen(false)
            setEditingJob(null)
            setMutationJobId('')
            setEditorSessionId('')
            setEditorBlock('')
            setEditorRecoveryError('')
          }
        }}
        onReload={editorBlock === 'conflict' || editorBlock === 'uncertain'
          ? () => void reloadJobEditor()
          : undefined}
        onSubmit={(value) => void saveJob(value)}
      />

      {rawSnapshot && enabled && rawSnapshot.session_id === (session?.id ?? '') ? (
        <CrontabRawEditorModal
          open
          snapshot={rawSnapshot}
          theme={theme}
          writable={Boolean(capability?.writable)}
          saving={crontab.mutation === 'replace'}
          onClose={() => setRawSnapshot(null)}
          onSave={crontab.replaceContent}
          onReload={reloadRawEditor}
        />
      ) : null}
    </section>
  )
}

function CrontabJobRow({
  job,
  writable,
  busy,
  deleting,
  deleteConfirmOpen,
  onDeleteConfirmOpenChange,
  onEdit,
  onToggle,
  onDelete,
}: {
  job: CrontabJob
  writable: boolean
  busy: boolean
  deleting: boolean
  deleteConfirmOpen: boolean
  onDeleteConfirmOpenChange: (open: boolean) => void
  onEdit: () => void
  onToggle: (checked: boolean) => void
  onDelete: () => Promise<void>
}) {
  const { t } = useTranslation()
  const editable = writable && job.editable
  return (
    <article className={[styles.job, job.enabled ? '' : styles['is-disabled']].filter(Boolean).join(' ')} role="listitem">
      <div className={styles['job-main']}>
        <div className={styles['job-schedule']}>
          <CalendarClock size={13} />
          <code>{job.expression}</code>
        </div>
        <Tooltip title={job.command} placement="topLeft">
          <code className={styles['job-command']}>{job.command}</code>
        </Tooltip>
        {!job.editable ? <span className={styles['job-warning']}>{t('workbench.crontab.notEditable')}</span> : null}
      </div>
      <div className={styles['job-footer']}>
        <span className={styles[job.enabled ? 'is-enabled' : 'is-muted']}>
          {t(job.enabled ? 'workbench.crontab.enabledState' : 'workbench.crontab.disabledState')}
        </span>
        <div className={styles['job-actions']}>
          <Switch
            size="small"
            checked={job.enabled}
            disabled={!editable || busy}
            aria-label={t('workbench.crontab.toggleJob', { expression: job.expression })}
            onChange={onToggle}
          />
          <Tooltip title={editable ? t('app.edit') : t('workbench.crontab.notEditable')}>
            <Button
              type="text"
              aria-label={t('workbench.crontab.editJob', { expression: job.expression })}
              disabled={!editable || busy}
              icon={<Pencil size={13} />}
              onClick={onEdit}
            />
          </Tooltip>
          <Popconfirm
            {...termousPopconfirmProps}
            open={deleteConfirmOpen}
            title={t('workbench.crontab.deleteTitle')}
            description={t('workbench.crontab.deleteHint')}
            okText={t('app.delete')}
            cancelText={t('app.cancel')}
            okButtonProps={{ danger: true, loading: deleting }}
            disabled={!editable || busy}
            onOpenChange={onDeleteConfirmOpenChange}
            onConfirm={onDelete}
          >
            <Button
              type="text"
              danger
              aria-label={t('workbench.crontab.deleteJob', { expression: job.expression })}
              disabled={!editable || busy}
              icon={<Trash2 size={13} />}
            />
          </Popconfirm>
        </div>
      </div>
    </article>
  )
}

function CrontabUnavailable({
  title,
  description,
  loading,
  onRetry,
}: {
  title: string
  description: string
  loading: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <WorkspaceEmptyState
      tone="warning"
      icon={<TriangleAlert size={20} />}
      title={title}
      description={description}
      action={(
        <Button icon={<RefreshCw size={14} />} loading={loading} onClick={onRetry}>
          {t('workbench.crontab.retry')}
        </Button>
      )}
    />
  )
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
