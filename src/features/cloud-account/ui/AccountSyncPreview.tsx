import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, Space, Table, Tooltip } from 'antd'
import { ArrowDownToLine, ArrowUpFromLine, CheckCheck, GitMerge, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudConflict, CloudPreview, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { WorkspaceEmptyState, FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { cloudOperationErrorCode, useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountLoading } from './AccountSection'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountSyncPreview.module.scss'

interface Props {
  api: CloudGateway
  status: CloudStatus
  open: boolean
  enableAutoSync: boolean
  busy: boolean
  blockingReason?: string
  onRetryBlocking?: () => void
  settingsUnavailable: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
  onEnable: () => Promise<boolean>
  onReloadSettings: () => void
  onClose: () => void
}
interface ReadScope { active: boolean; request: number }

export function AccountSyncPreview({ api, status, open, enableAutoSync, busy, blockingReason, onRetryBlocking, settingsUnavailable, run, onEnable, onReloadSettings, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const generation = status.generation
  const [preview, setPreview] = useState<CloudPreview>()
  const [conflicts, setConflicts] = useState<CloudConflict[]>([])
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState<string>()
  const [applied, setApplied] = useState(false)
  const [enableFailed, setEnableFailed] = useState(false)
  const life = useRef<ReadScope | null>(null)
  const feedback = useCloudOperationFeedback(api, generation, run)
  const resetFeedback = useRef(feedback.reset)
  resetFeedback.current = feedback.reset

  const load = useCallback(async (scope: ReadScope) => {
    const request = ++scope.request
    const current = () => scope.active && request === scope.request && api.getStatus()?.generation === generation
    if (!current()) return
    setLoading(true); setReadError(undefined); setPreview(undefined); setConflicts([])
    try {
      const value = await api.preview(generation)
      if (!current()) return
      if (value.generation !== generation) throw new Error('CLOUD_RESPONSE_INVALID')
      const items = await api.conflicts()
      // 差异和冲突必须完整取得；关闭、切换账号或 Core 后的响应不得恢复旧预览。
      if (!current()) return
      setPreview(value); setConflicts(items)
    } catch (cause) {
      if (current()) setReadError(cloudOperationErrorCode(cause, code => i18n.exists(`cloud.errors.${code}`)))
    } finally { if (current()) setLoading(false) }
  }, [api, generation, i18n])

  useEffect(() => {
    const scope = { active: open, request: 0 }
    life.current = scope
    setApplied(false); setEnableFailed(false); setReadError(undefined); setPreview(undefined); setConflicts([])
    resetFeedback.current()
    if (open) void load(scope)
    return () => { scope.active = false }
  }, [open, load])

  const writing = busy || feedback.working
  const disabled = writing || loading || Boolean(blockingReason) || (enableAutoSync && settingsUnavailable)
  const canConfirm = !disabled && (applied || Boolean(preview && !preview.blocked && conflicts.length === 0))
  const refresh = () => {
    feedback.reset()
    if (life.current) void load(life.current)
  }
  const retryPrerequisite = blockingReason && onRetryBlocking ? onRetryBlocking : enableAutoSync && settingsUnavailable ? onReloadSettings : undefined
  const confirm = () => void feedback.perform(async current => {
    if (!canConfirm) return
    if (!applied) {
      try {
        const result = await api.confirm(generation, preview!.id)
        if (!current()) return
        if (result.generation !== generation) throw new Error('CLOUD_RESPONSE_INVALID')
        setApplied(true)
      } catch (cause) {
        // 失败可能发生在部分提交后，旧预览不能再次作为确认依据。
        if (current()) { setPreview(undefined); setConflicts([]) }
        throw cause
      }
    }
    // 同步已完成但设置保存失败时，只重试开启开关，不再次提交同一预览。
    if (enableAutoSync) {
      const enabled = await onEnable()
      if (!current()) return
      if (!enabled) { setEnableFailed(true); return }
    }
    if (current()) onClose()
  })
  const rows = preview?.items.filter(item => item.upload + item.download + item.delete + item.conflicts > 0) ?? []
  const totals = preview?.items.reduce((sum, item) => ({ upload: sum.upload + item.upload, download: sum.download + item.download, delete: sum.delete + item.delete, conflicts: sum.conflicts + item.conflicts }), { upload: 0, download: 0, delete: 0, conflicts: 0 })
  const errorCode = readError ?? feedback.errorCode
  const confirmLabel = t(enableFailed ? 'cloud.syncFlow.retryEnable' : 'cloud.syncFlow.confirmOnce')
  const columns: { key: 'upload' | 'download' | 'delete' | 'conflicts'; label: string; icon: ReactNode }[] = [
    { key: 'upload', label: t('cloud.upload'), icon: <ArrowUpFromLine size={14} /> },
    { key: 'download', label: t('cloud.download'), icon: <ArrowDownToLine size={14} /> },
    ...(totals?.delete ? [{ key: 'delete' as const, label: t('cloud.deletion'), icon: <Trash2 size={14} /> }] : []),
    ...(totals?.conflicts ? [{ key: 'conflicts' as const, label: t('cloud.conflicts'), icon: <GitMerge size={14} /> }] : []),
  ]

  return <Modal open={open} centered width={640} title={t('cloud.previewTitle')} className={styles.modal} destroyOnHidden closable={!writing} mask={{ closable: !writing }} keyboard={!writing} onCancel={onClose} footer={
    <div className={styles.footer}>
      <Button type="text" icon={<RefreshCw size={14} />} disabled={writing || loading || !retryPrerequisite && (applied || status.device_status !== 'active')} onClick={retryPrerequisite ?? refresh}>{t(retryPrerequisite ? 'cloud.retry' : 'cloud.syncFlow.refreshPreview')}</Button>
      <Space><Button disabled={writing} onClick={onClose}>{t('app.cancel')}</Button><Button type="primary" aria-label={confirmLabel} loading={writing} disabled={!canConfirm} onClick={confirm}>{confirmLabel}</Button></Space>
    </div>
  }><FeedbackMessageScope active={open}>
    <div className={styles.body}>
      {enableAutoSync && !applied ? <p className={styles.description}>{t('cloud.syncFlow.previewEnableHint')}</p> : null}
      {blockingReason && blockingReason !== t('cloud.loading') ? <FeedbackMessage type="warning" title={blockingReason} /> : null}
      {enableAutoSync && settingsUnavailable && !busy ? <FeedbackMessage type="warning" title={t('cloud.syncFlow.settingsUnavailable')} /> : null}
      <AccountOperationError code={errorCode} />
      {enableFailed ? <FeedbackMessage type="warning" title={t('cloud.syncFlow.enableFailed')} description={t('cloud.syncFlow.enableRetryHint')} /> : null}
      {loading ? <AccountLoading label={t('cloud.syncFlow.loadingPreview')} /> : null}
      {preview && !applied ? <>
        {preview.blocked && conflicts.length === 0 ? <FeedbackMessage type="warning" title={t(`cloud.errors.${preview.error_code}`, { defaultValue: t('cloud.previewBlocked') })} /> : null}
        {rows.length ? <Table className={styles.table} size="small" rowKey="dataset" pagination={false} dataSource={rows} tableLayout="fixed" columns={[
          { title: t('cloud.dataset'), dataIndex: 'dataset', render: (dataset: string) => t(`cloud.datasets.${dataset}`) },
          ...columns.map(({ key, label, icon }) => ({
            title: <Tooltip title={label}><span className={styles['column-heading']} tabIndex={0} aria-label={label}><span className={styles['column-icon']} aria-hidden="true">{icon}</span><span className={styles['column-label']}>{label}</span></span></Tooltip>,
            dataIndex: key,
            align: 'right' as const,
            width: '17%',
            render: (count: number) => <span className={count ? key === 'delete' || key === 'conflicts' ? styles.attention : undefined : styles.zero}>{count || '—'}</span>,
          })),
        ]} summary={() => <Table.Summary.Row>
          <Table.Summary.Cell index={0}>{t('cloud.syncFlow.total')}</Table.Summary.Cell>
          {columns.map(({ key }, index) => <Table.Summary.Cell key={key} index={index + 1} align="right">{totals?.[key] ?? 0}</Table.Summary.Cell>)}
        </Table.Summary.Row>} /> : !preview.blocked && conflicts.length === 0 ? <WorkspaceEmptyState className={styles.empty} icon={<CheckCheck size={24} />} title={t('cloud.noChanges')} /> : null}
        {conflicts.length ? <section className={styles.conflicts} aria-label={t('cloud.conflicts')}>
          <h3>{t('cloud.syncFlow.resolve')}</h3><p className={styles.description}>{t('cloud.conflictHint')}</p>
          {conflicts.map(conflict => <div className={styles.conflict} key={conflict.id}>
            <div><strong>{conflict.name}</strong><small>{t(`cloud.datasets.${conflict.dataset}`)}{conflict.local_deleted || conflict.remote_deleted ? ` · ${t('cloud.deleteConflict')}` : ''}</small></div>
            <Space wrap>{(['local', 'remote'] as const).map(choice => <Button key={choice} disabled={disabled} onClick={() => void feedback.perform(async current => {
              await api.resolve(generation, conflict.id, choice)
              if (current() && life.current?.active) await load(life.current)
            })}>{t(`cloud.keep.${choice}`)}</Button>)}</Space>
          </div>)}
        </section> : null}
      </> : null}
      <p className={styles.note}><ShieldCheck size={14} aria-hidden="true" />{t('cloud.syncFlow.scopeHint')}</p>
    </div>
  </FeedbackMessageScope></Modal>
}
