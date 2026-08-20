import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { McpApprovalTarget } from '#entities/mcp-access'
import styles from '../McpApprovalCoordinator.module.scss'

export function ApprovalTargets({ targets }: { targets: McpApprovalTarget[] }) {
  const { t } = useTranslation()
  if (targets.length === 0) return null
  return (
    <div className={styles.targets}>
      <span>{t('settings.mcp.approval.targets', { count: targets.length })}</span>
      <div>
        {targets.map((target) => (
          <Tag key={target.id} title={target.id}>
            {target.host_name || target.endpoint || target.id}
            {target.host_name && target.endpoint ? ` · ${target.endpoint}` : ''}
          </Tag>
        ))}
      </div>
    </div>
  )
}

export function ApprovalPaths({ label, paths }: { label: string; paths: string[] }) {
  if (paths.length === 0) return null
  return (
    <div className={styles['path-group']}>
      <span>{label}</span>
      <div className={styles['path-list']}>
        {paths.map((path, index) => <code key={`${index}:${path}`}>{path}</code>)}
      </div>
    </div>
  )
}

export function ApprovalValue({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return (
    <div className={styles['detail-group']}>
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  )
}

export function ApprovalScrollableCode({ value }: { value: string }) {
  return <pre>{value}</pre>
}

export function ApprovalScrollableValue({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles['command-group']}>
      <span>{label}</span>
      <ApprovalScrollableCode value={value} />
    </div>
  )
}
