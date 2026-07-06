import { ArrowLeftRight, Cable, Monitor, Network, RadioTower, Route, Server, type LucideIcon } from 'lucide-react'
import { App as AntdApp, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ForwardMode } from '../../types/domain'

interface ForwardRouteDiagramProps {
  mode: ForwardMode
  bindHost: string
  bindPort: number
  boundAddress?: string
  targetHost?: string
  targetPort?: number
  compact?: boolean
}

export function ForwardRouteDiagram({
  mode,
  bindHost,
  bindPort,
  boundAddress,
  targetHost,
  targetPort,
  compact = false,
}: ForwardRouteDiagramProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const route = routeCopy(mode, t)
  const sourceValue = boundAddress || `${bindHost}:${bindPort}`
  const targetValue = mode === 'dynamic' ? t('forwards.route.requestTarget') : `${targetHost || '-'}:${targetPort || '-'}`
  const copyAddress = async (value: string) => {
    try {
      await writeClipboardText(value)
      void message.success(t('forwards.copyAddressDone', { address: value }))
    } catch {
      void message.error(t('forwards.copyAddressFailed'))
    }
  }

  return (
    <div className={`forward-route-diagram is-${mode}${compact ? ' is-compact' : ''}`}>
      <ForwardEndpoint icon={route.sourceIcon} label={route.sourceLabel} value={sourceValue} onCopy={copyAddress} />
      <div className="forward-route-link" aria-hidden="true">
        <span className="forward-route-line" />
        <span className="forward-route-mark">
          <route.linkIcon size={17} strokeWidth={2.35} />
        </span>
        <small>{route.channelLabel}</small>
      </div>
      <ForwardEndpoint icon={route.targetIcon} label={route.targetLabel} value={targetValue} onCopy={mode === 'dynamic' ? undefined : copyAddress} />
    </div>
  )
}

type RouteIcon = LucideIcon

function ForwardEndpoint({
  icon: Icon,
  label,
  value,
  onCopy,
}: {
  icon: RouteIcon
  label: string
  value: string
  onCopy?: (value: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const canCopy = Boolean(onCopy && isConcreteAddress(value))
  const content = (
    <button
      type="button"
      className={`forward-route-endpoint${canCopy ? ' is-copyable' : ''}`}
      aria-label={canCopy ? t('forwards.copyAddress', { address: value }) : `${label} ${value}`}
      aria-disabled={!canCopy}
      onClick={() => {
        if (canCopy) {
          void onCopy?.(value)
        }
      }}
    >
      <span className="forward-route-endpoint-icon">
        <Icon size={15} strokeWidth={2.15} />
      </span>
      <span className="forward-route-endpoint-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </span>
    </button>
  )
  return (
    <Tooltip title={value} mouseEnterDelay={0.25} classNames={{ root: 'forward-route-tooltip' }}>
      {content}
    </Tooltip>
  )
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) {
    throw new Error('copy failed')
  }
}

function isConcreteAddress(value: string) {
  return value.includes(':') && !value.includes('-')
}

function routeCopy(mode: ForwardMode, t: (key: string) => string) {
  switch (mode) {
    case 'remote':
      return {
        sourceIcon: RadioTower,
        sourceLabel: t('forwards.route.remoteListen'),
        targetIcon: Monitor,
        targetLabel: t('forwards.route.localTarget'),
        linkIcon: ArrowLeftRight,
        channelLabel: t('forwards.route.reverseChannel'),
      }
    case 'dynamic':
      return {
        sourceIcon: Network,
        sourceLabel: t('forwards.route.localSocks'),
        targetIcon: Route,
        targetLabel: t('forwards.route.dynamicTarget'),
        linkIcon: Cable,
        channelLabel: t('forwards.route.socksChannel'),
      }
    default:
      return {
        sourceIcon: Monitor,
        sourceLabel: t('forwards.route.localListen'),
        targetIcon: Server,
        targetLabel: t('forwards.route.remoteTarget'),
        linkIcon: Route,
        channelLabel: t('forwards.route.sshChannel'),
      }
  }
}
