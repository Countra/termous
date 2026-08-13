import {
  Cable,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cpu,
  HardDrive,
  Layers,
  Monitor,
  Network as NetworkIcon,
  RotateCcw,
  Server,
  TriangleAlert,
} from 'lucide-react'
import { Button, Skeleton, Tooltip } from 'antd'
import { useState, type ReactNode } from 'react'
import { uiStyles, WorkspaceEmptyState as WorkbenchEmptyState } from '#shared/ui'
import type { Session } from '#entities/session'
import { formatWorkbenchTime } from '../model/workbenchFormatters'
import styles from './WorkbenchDetails.module.scss'

type WorkbenchTranslate = (key: string, options?: Record<string, string | number>) => string

interface SystemInfoTreeNode {
  key: string
  icon?: ReactNode
  label: string
  value: string
  children?: SystemInfoTreeNode[]
}

interface WorkbenchSystemInfoPanelProps {
  session: Session | null
  t: WorkbenchTranslate
  requesting: boolean
  requestError: string
  onRetry: () => void
}

export function WorkbenchSystemInfoPanel({
  session,
  t,
  requesting,
  requestError,
  onRetry,
}: WorkbenchSystemInfoPanelProps) {
  const status = session?.inventory_status ?? 'idle'
  const info = session?.linux_system_info
  const [expandedKeys, setExpandedKeys] = useState(() => new Set<string>())
  if (!session || session.kind !== 'ssh' || session.status !== 'connected') {
    return (
      <WorkbenchEmptyState
        icon={<Monitor size={20} />}
        title={t('workbench.systemInfo.emptyTitle')}
        description={t('workbench.systemInfo.emptyHint')}
      />
    )
  }
  if ((status === 'collecting' || status === 'idle') && !requestError) {
    return (
      <div className={styles['system-info-loading']}>
        <div>
          <strong>{t('workbench.systemInfo.loadingTitle')}</strong>
          <span>{t('workbench.systemInfo.loadingHint')}</span>
        </div>
        <Skeleton active paragraph={{ rows: 5 }} title={false} />
      </div>
    )
  }
  if (status !== 'ready' || !info) {
    const failed = status === 'failed' || Boolean(requestError)
    return (
      <WorkbenchEmptyState
        className={`system-info-message is-${status}`}
        tone={failed ? 'danger' : 'warning'}
        icon={<TriangleAlert size={18} />}
        title={status === 'unsupported' ? t('workbench.systemInfo.unsupportedTitle') : t('workbench.systemInfo.failedTitle')}
        description={requestError || session.inventory_message || t('workbench.systemInfo.failedHint')}
        action={failed ? (
          <Button
            size="small"
            className={`${uiStyles['secondary-button']} secondary-button`}
            loading={requesting}
            disabled={requesting}
            icon={<RotateCcw size={14} />}
            onClick={onRetry}
          >
            {requesting ? t('workbench.systemInfo.retrying') : t('workbench.systemInfo.retry')}
          </Button>
        ) : undefined}
      />
    )
  }
  const nodes = buildSystemInfoTree(info, t)
  const toggleNode = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  return (
    <div className={styles['system-info-panel']}>
      <div className={styles['system-info-summary']}>
        <span className={styles['system-info-platform']}>
          <Server size={14} />
          {t('hosts.platform.linux')}
        </span>
        <Tooltip title={info.os_pretty_name || info.os_name || t('workbench.systemInfo.unknownOS')}>
          <strong>{info.os_pretty_name || info.os_name || t('workbench.systemInfo.unknownOS')}</strong>
        </Tooltip>
        <span>{info.collected_at ? t('workbench.systemInfo.collectedAt', { time: formatWorkbenchTime(info.collected_at) }) : t('fields.none')}</span>
      </div>
      <div className={styles['system-info-tree']} role="tree">
        {nodes.map((node) => (
          <SystemInfoTreeRow key={node.key} node={node} expandedKeys={expandedKeys} level={0} onToggle={toggleNode} />
        ))}
      </div>
    </div>
  )
}

function SystemInfoTreeRow({
  node,
  expandedKeys,
  level,
  onToggle,
}: {
  node: SystemInfoTreeNode
  expandedKeys: Set<string>
  level: number
  onToggle: (key: string) => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const expanded = hasChildren && expandedKeys.has(node.key)
  return (
    <div
      className={[
        styles['system-info-tree-node'],
        styles[`level-${level}`],
      ].filter(Boolean).join(' ')}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <button
        type="button"
        className={[
          styles['system-info-tree-row'],
          hasChildren ? styles['is-expandable'] : '',
        ].filter(Boolean).join(' ')}
        onClick={() => hasChildren && onToggle(node.key)}
      >
        <span className={styles['system-info-tree-label']}>
          <span className={styles['system-info-tree-toggle']} aria-hidden="true">
            {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
          </span>
          {node.icon ? <span className={styles['system-info-tree-icon']}>{node.icon}</span> : null}
          <span>{node.label}</span>
        </span>
        <Tooltip title={node.value}>
          <span className={styles['system-info-tree-value']}>{node.value}</span>
        </Tooltip>
      </button>
      {expanded && node.children?.length ? (
        <div className={styles['system-info-tree-children']} role="group">
          {node.children.map((child) => (
            <SystemInfoTreeRow key={child.key} node={child} expandedKeys={expandedKeys} level={level + 1} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildSystemInfoTree(info: NonNullable<Session['linux_system_info']>, t: WorkbenchTranslate): SystemInfoTreeNode[] {
  return [
    { key: 'hostname', icon: <Monitor size={15} />, label: t('workbench.systemInfo.hostname'), value: valueOrNone(info.hostname, t) },
    { key: 'kernel', icon: <Layers size={15} />, label: t('workbench.systemInfo.kernel'), value: valueOrNone(info.kernel, t) },
    {
      key: 'cpu',
      icon: <Cpu size={15} />,
      label: t('workbench.systemInfo.cpu'),
      value: valueOrNone(info.cpu_model, t),
      children: [
        { key: 'cpu-cores', label: t('workbench.systemInfo.cpuCores'), value: formatCPUCoreCount(info.cpu_cores, t) },
        { key: 'cpu-frequency', label: t('workbench.systemInfo.cpuFrequency'), value: formatCPUFrequency(info.cpu_frequency_mhz, t) },
      ],
    },
    { key: 'memory', icon: <HardDrive size={15} />, label: t('workbench.systemInfo.memory'), value: formatMemory(info.memory_total_bytes, t) },
    buildSystemNetworkNode(info, t),
    { key: 'architecture', icon: <Cable size={15} />, label: t('workbench.systemInfo.architecture'), value: valueOrNone(info.architecture, t) },
    { key: 'uptime', icon: <Clock3 size={15} />, label: t('workbench.systemInfo.uptime'), value: formatUptime(info.uptime_seconds, t) },
  ]
}

function buildSystemNetworkNode(info: NonNullable<Session['linux_system_info']>, t: WorkbenchTranslate): SystemInfoTreeNode {
  const network = info.network
  const interfaces = (Array.isArray(network?.interfaces) ? network.interfaces : []).filter(Boolean)
  const addressCount = interfaces.reduce(
    (total, networkInterface) => total + (Array.isArray(networkInterface?.addresses) ? networkInterface.addresses.length : 0),
    0,
  )
  let value = t('workbench.systemInfo.networkUnavailable')
  if (network?.status === 'failed') {
    value = t('workbench.systemInfo.networkFailed')
  } else if (network?.status === 'partial') {
    value = t('workbench.systemInfo.networkSummaryPartial', { interfaces: interfaces.length, addresses: addressCount })
  } else if (network?.status === 'ready') {
    value = interfaces.length
      ? t('workbench.systemInfo.networkSummary', { interfaces: interfaces.length, addresses: addressCount })
      : t('workbench.systemInfo.networkNoInterfaces')
  }
  return {
    key: 'network',
    icon: <NetworkIcon size={15} />,
    label: t('workbench.systemInfo.network'),
    value,
    children: interfaces.map((networkInterface, interfacePosition) => {
      const addresses = (Array.isArray(networkInterface?.addresses) ? networkInterface.addresses : []).filter(Boolean)
      const rawInterfaceName = networkInterface?.name?.trim() || ''
      const interfaceName = rawInterfaceName || t('workbench.systemInfo.unnamedInterface', { index: interfacePosition + 1 })
      const interfaceKey = `${networkInterface?.index ?? 0}-${rawInterfaceName || 'unnamed'}-${interfacePosition}`
      return {
        key: `network-interface-${interfaceKey}`,
        label: interfaceName,
        value: addresses.length
          ? t('workbench.systemInfo.interfaceAddressCount', { count: addresses.length })
          : t('workbench.systemInfo.noAssignedAddress'),
        children: addresses.map((address, addressPosition) => ({
          key: `network-address-${interfaceKey}-${address.family}-${address.address}-${address.prefix_length}-${addressPosition}`,
          label: address.family === 'ipv6' ? t('workbench.systemInfo.ipv6') : t('workbench.systemInfo.ipv4'),
          value: formatNetworkAddress(address.address, address.prefix_length, t),
        })),
      }
    }),
  }
}

function formatNetworkAddress(address: string, prefixLength: number, t: WorkbenchTranslate): string {
  const normalizedAddress = address?.trim()
  if (!normalizedAddress) {
    return t('fields.none')
  }
  return Number.isInteger(prefixLength) && prefixLength >= 0 ? `${normalizedAddress}/${prefixLength}` : normalizedAddress
}

function valueOrNone(value: string | undefined, t: WorkbenchTranslate) {
  return value && value.trim() ? value : t('fields.none')
}

function formatCPUCoreCount(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  return t('workbench.systemInfo.cpuCoreCount', { count: value })
}

function formatCPUFrequency(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  if (value >= 1000) {
    return `${trimDecimal(value / 1000, 2)} GHz`
  }
  return `${trimDecimal(value, 0)} MHz`
}

function trimDecimal(value: number, digits: number) {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

function formatMemory(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  const gib = value / 1024 / 1024 / 1024
  if (gib >= 1) {
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`
  }
  return `${(value / 1024 / 1024).toFixed(0)} MB`
}

function formatUptime(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (days > 0) {
    return t('workbench.systemInfo.uptimeDays', { days, hours })
  }
  if (hours > 0) {
    return t('workbench.systemInfo.uptimeHours', { hours, minutes })
  }
  return t('workbench.systemInfo.uptimeMinutes', { minutes: Math.max(minutes, 1) })
}
