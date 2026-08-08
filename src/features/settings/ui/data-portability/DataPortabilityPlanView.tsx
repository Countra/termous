import { Button, Empty, Select, Tag, Tooltip } from 'antd'
import { ChevronLeft, ChevronRight, GitCompareArrows, Layers3, ListFilter, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { customSelectStyles } from '#shared/ui'
import type {
  DataPortabilityPlanItem,
  DataPortabilityPlanItemPage,
  DataPortabilityPlanStatus,
  DataPortabilityResolution,
  DataPortabilityRestorePlan,
} from '#common/contracts'
import { formatDifferenceValue } from '../../model/dataPortability'
import styles from './DataPortability.module.scss'

type PlanStatusFilter = 'all' | DataPortabilityPlanStatus

interface DataPortabilityPlanViewProps {
  plan: DataPortabilityRestorePlan
  page: DataPortabilityPlanItemPage | null
  statusFilter: PlanStatusFilter
  pageNumber: number
  busy: boolean
  canGoBack: boolean
  canGoForward: boolean
  onStatusFilterChange: (value: PlanStatusFilter) => void
  onPreviousPage: () => void
  onNextPage: () => void
  onResolve: (action: DataPortabilityResolution, itemKeys?: string[]) => void
  onEditSelection?: () => void
  onApply: () => void
}

const statusOrder: DataPortabilityPlanStatus[] = ['added', 'unchanged', 'conflict', 'dependency', 'skipped', 'removed']
const statusToneClassNames: Partial<Record<DataPortabilityPlanStatus, string>> = {
  added: styles['is-added'],
  conflict: styles['is-conflict'],
  removed: styles['is-removed'],
}

export function DataPortabilityPlanView({
  plan,
  page,
  statusFilter,
  pageNumber,
  busy,
  canGoBack,
  canGoForward,
  onStatusFilterChange,
  onPreviousPage,
  onNextPage,
  onResolve,
  onEditSelection,
  onApply,
}: DataPortabilityPlanViewProps) {
  const { t } = useTranslation()
  const unresolved = plan.summary.unresolved ?? 0
  const items = page?.items ?? []

  return (
    <div className={styles['data-portability-plan']}>
      <div className={styles['data-portability-plan-heading']}>
        <div>
          <span className={styles['data-portability-eyebrow']}>{t('settings.data.planTitle')}</span>
          <strong>{t(`settings.data.modes.${plan.mode}.title`)}</strong>
        </div>
        <div className={styles['data-portability-plan-actions']}>
          {onEditSelection ? (
            <Button icon={<SlidersHorizontal size={15} />} disabled={busy} onClick={onEditSelection}>
              {t('settings.data.editSelection')}
            </Button>
          ) : null}
          <Button type="primary" disabled={busy || unresolved > 0} onClick={onApply}>
            {t('settings.data.applyRestore')}
          </Button>
        </div>
      </div>

      <div className={styles['data-portability-impact-grid']}>
        <ImpactMetric icon={<Layers3 size={15} />} label={t('settings.data.impactTotal')} value={plan.summary.total ?? 0} />
        {statusOrder.map((status) => (
          <ImpactMetric
            key={status}
            label={t(`settings.data.status.${status}`)}
            value={plan.summary.by_status?.[status] ?? 0}
            tone={status}
          />
        ))}
      </div>

      <div className={styles['data-portability-plan-toolbar']}>
        <div className={styles['data-portability-filter-label']}>
          <ListFilter size={15} aria-hidden="true" />
          <span>{t('settings.data.itemFilter')}</span>
        </div>
        <Select<PlanStatusFilter>
          value={statusFilter}
          classNames={{ popup: { root: `${customSelectStyles['select-popup']} termous-select-popup ${styles['data-portability-select-popup']}` } }}
          options={[
            { value: 'all', label: t('settings.data.status.all') },
            ...statusOrder.map((status) => ({ value: status, label: t(`settings.data.status.${status}`) })),
          ]}
          onChange={onStatusFilterChange}
        />
        {unresolved > 0 ? (
          <div className={styles['data-portability-batch-actions']}>
            <span>{t('settings.data.unresolvedCount', { count: unresolved })}</span>
            <Button size="small" disabled={busy} onClick={() => onResolve('keep_current')}>
              {t('settings.data.actions.keep_current')}
            </Button>
            <Button size="small" disabled={busy} onClick={() => onResolve('use_backup')}>
              {t('settings.data.actions.use_backup')}
            </Button>
          </div>
        ) : (
          <span className={styles['data-portability-plan-ready']}>{t('settings.data.planReady')}</span>
        )}
      </div>

      <div className={styles['data-portability-item-list']} aria-busy={busy}>
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.data.noPlanItems')} />
        ) : (
          items.map((item) => (
            <PlanItem key={item.key} item={item} busy={busy} onResolve={onResolve} />
          ))
        )}
      </div>

      <div className={styles['data-portability-pagination']}>
        <span>{t('settings.data.pageSummary', { page: pageNumber, total: page?.total ?? 0 })}</span>
        <div>
          <Tooltip title={t('settings.data.previousPage')}>
            <Button
              aria-label={t('settings.data.previousPage')}
              icon={<ChevronLeft size={16} />}
              disabled={!canGoBack || busy}
              onClick={onPreviousPage}
            />
          </Tooltip>
          <Tooltip title={t('settings.data.nextPage')}>
            <Button
              aria-label={t('settings.data.nextPage')}
              icon={<ChevronRight size={16} />}
              disabled={!canGoForward || busy}
              onClick={onNextPage}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

function ImpactMetric({ icon, label, value, tone }: { icon?: ReactNode; label: string; value: number; tone?: DataPortabilityPlanStatus }) {
  const toneClassName = tone ? statusToneClassNames[tone] : undefined
  return (
    <div className={`${styles['data-portability-impact']}${toneClassName ? ` ${toneClassName}` : ''}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PlanItem({
  item,
  busy,
  onResolve,
}: {
  item: DataPortabilityPlanItem
  busy: boolean
  onResolve: (action: DataPortabilityResolution, itemKeys?: string[]) => void
}) {
  const { t } = useTranslation()
  const actions = item.allowed_actions ?? []
  const differences = item.differences ?? []
  return (
    <article className={`${styles['data-portability-item']}${statusToneClassNames[item.status] ? ` ${statusToneClassNames[item.status]}` : ''}`}>
      <div className={styles['data-portability-item-main']}>
        <div className={styles['data-portability-item-icon']}><GitCompareArrows size={16} /></div>
        <div className={styles['data-portability-item-copy']}>
          <strong title={item.label}>{item.label}</strong>
          <span>{t(`settings.data.datasets.${item.reference.dataset}`)}</span>
        </div>
        <Tag className={`${styles['data-portability-status-tag']}${statusToneClassNames[item.status] ? ` ${statusToneClassNames[item.status]}` : ''}`}>
          {t(`settings.data.status.${item.status}`)}
        </Tag>
      </div>
      {item.reason ? <p className={styles['data-portability-item-reason']}>{item.reason}</p> : null}
      {differences.length > 0 ? (
        <div className={styles['data-portability-differences']}>
          {differences.slice(0, 4).map((difference) => (
            <div key={difference.field}>
              <span>{difference.field}</span>
              {difference.sensitive ? (
                <strong>{t('settings.data.sensitiveChanged')}</strong>
              ) : (
                <Tooltip title={`${formatDifferenceValue(difference.current)} -> ${formatDifferenceValue(difference.backup)}`}>
                  <strong>{formatDifferenceValue(difference.current)} -&gt; {formatDifferenceValue(difference.backup)}</strong>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className={styles['data-portability-item-actions']}>
          {actions.map((action) => (
            <Button
              key={action}
              size="small"
              type={item.resolution === action ? 'primary' : 'default'}
              disabled={busy}
              onClick={() => onResolve(action, [item.key])}
            >
              {t(`settings.data.actions.${action}`)}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  )
}
