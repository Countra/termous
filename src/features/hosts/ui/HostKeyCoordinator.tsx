import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App as AntdApp, Button, Modal, Tag, Typography } from 'antd'
import { Clock3, Server, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TermousApiError } from '#shared/api'
import type { Host } from '#entities/host'
import type {
  HostKeyChallenge,
  HostKeyDecisionAction,
  HostKeyEvent,
  HostKeyObservationContext,
} from '#entities/host-key'
import type { HostKeyGateway } from '../api/hostKeyGateway.ts'
import {
  hostKeyCoordinatorReducer,
  hostKeyEventNeedsReconciliation,
  initialHostKeyCoordinatorState,
} from '../model/hostKeyState.ts'
import styles from './HostKeyCoordinator.module.scss'

export interface HostKeyCoordinatorProps {
  api: HostKeyGateway
  enabled: boolean
  hosts: Host[]
}

const reconnectDelayInitial = 800
const reconnectDelayMaximum = 5000

export function HostKeyCoordinator({ api, enabled, hosts }: HostKeyCoordinatorProps) {
  const { t, i18n } = useTranslation()
  const { notification } = AntdApp.useApp()
  const stateRef = useRef(initialHostKeyCoordinatorState)
  const requestSequenceRef = useRef(0)
  const reconcileAbortRef = useRef<AbortController | null>(null)
  const [state, setState] = useState(initialHostKeyCoordinatorState)
  const [decisionBusy, setDecisionBusy] = useState(false)

  const applyState = useCallback((action: Parameters<typeof hostKeyCoordinatorReducer>[1]) => {
    setState((current) => {
      const next = hostKeyCoordinatorReducer(current, action)
      stateRef.current = next
      return next
    })
  }, [])

  const reconcile = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current
    reconcileAbortRef.current?.abort()
    const controller = new AbortController()
    reconcileAbortRef.current = controller
    try {
      const snapshot = await api.hostKeyChallenges(controller.signal)
      if (requestSequence !== requestSequenceRef.current) {
        return
      }
      applyState({ type: 'snapshot', snapshot })
    } finally {
      if (reconcileAbortRef.current === controller) {
        reconcileAbortRef.current = null
      }
    }
  }, [api, applyState])

  useEffect(() => {
    if (!enabled) {
      requestSequenceRef.current += 1
      reconcileAbortRef.current?.abort()
      reconcileAbortRef.current = null
      applyState({ type: 'clear' })
      return undefined
    }

    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let reconnectDelay = reconnectDelayInitial

    const reconcileSafely = () => {
      void reconcile().catch(() => undefined)
    }
    const connect = () => {
      if (disposed) {
        return
      }
      socket = new WebSocket(api.hostKeyEventsUrl())
      socket.onopen = () => {
        reconnectDelay = reconnectDelayInitial
        reconcileSafely()
      }
      socket.onmessage = (message: MessageEvent<string>) => {
        const event = parseHostKeyEvent(message.data)
        if (!event) {
          reconcileSafely()
          return
        }
        if (hostKeyEventNeedsReconciliation(stateRef.current, event)) {
          reconcileSafely()
          return
        }
        applyState({ type: 'event', event })
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        socket = null
        if (disposed) {
          return
        }
        reconnectTimer = window.setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, reconnectDelayMaximum)
      }
    }

    reconcileSafely()
    connect()
    return () => {
      disposed = true
      requestSequenceRef.current += 1
      reconcileAbortRef.current?.abort()
      reconcileAbortRef.current = null
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, applyState, enabled, reconcile])

  const hostNames = useMemo(() => new Map(hosts.map((host) => [host.id, host.name])), [hosts])
  const challenge = state.challenges[0] ?? null

  const decide = async (action: HostKeyDecisionAction) => {
    if (!challenge || decisionBusy) {
      return
    }
    setDecisionBusy(true)
    try {
      const resolution = await api.decideHostKeyChallenge(challenge.id, action)
      applyState({ type: 'resolved', challengeId: resolution.challenge_id })
    } catch (error) {
      if (isReconciliationError(error)) {
        notification.warning({
          title: t('hostKey.decisionExpiredTitle'),
          description: t('hostKey.decisionExpiredDescription'),
          duration: 4,
          role: 'status',
          className: 'termous-notification',
        })
        void reconcile().catch(() => undefined)
      } else {
        notification.error({
          title: t('hostKey.decisionFailedTitle'),
          description: t('hostKey.decisionFailedDescription'),
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
      }
    } finally {
      setDecisionBusy(false)
    }
  }

  const changed = challenge?.reason === 'changed'
  return (
    <Modal
      open={Boolean(challenge)}
      centered
      width={600}
      zIndex={4000}
      title={null}
      footer={null}
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      rootClassName={styles['host-key-modal-root']}
      className={styles['host-key-modal']}
    >
      {challenge ? (
        <section
          className={[styles['host-key-dialog'], changed ? styles['is-changed'] : ''].filter(Boolean).join(' ')}
          aria-live="assertive"
        >
          <header className={styles['host-key-dialog-header']}>
            <span className={styles['host-key-dialog-icon']} aria-hidden="true">
              {changed ? <ShieldAlert size={23} /> : <ShieldQuestion size={23} />}
            </span>
            <div>
              <h2>{t(changed ? 'hostKey.changedTitle' : 'hostKey.unknownTitle')}</h2>
              <p>{t(changed ? 'hostKey.changedDescription' : 'hostKey.unknownDescription')}</p>
            </div>
          </header>

          {changed ? (
            <Alert
              type="warning"
              showIcon
              message={t('hostKey.changedWarning')}
              description={t('hostKey.changedWarningDescription')}
            />
          ) : null}

          <div className={styles['host-key-endpoint']}>
            <span className={styles['host-key-endpoint-icon']} aria-hidden="true"><Server size={18} /></span>
            <div className={styles['host-key-endpoint-copy']}>
              <small>{t('hostKey.endpoint')}</small>
              <strong>{formatEndpoint(challenge)}</strong>
            </div>
            <Tag className={styles['host-key-algorithm']}>{challenge.observed_key.algorithm || t('fields.none')}</Tag>
          </div>

          <dl className={styles['host-key-facts']} aria-label={t('hostKey.fingerprint')}>
            {changed ? (
              <div>
                <dt>{t('hostKey.savedFingerprint')}</dt>
                <dd><Fingerprint value={challenge.existing_fingerprint_sha256} /></dd>
              </div>
            ) : null}
            <div>
              <dt>{t(changed ? 'hostKey.currentFingerprint' : 'hostKey.fingerprint')}</dt>
              <dd><Fingerprint value={challenge.observed_key.fingerprint_sha256} /></dd>
            </div>
          </dl>

          <AffectedWorkflows challenge={challenge} hostNames={hostNames} />

          <footer className={styles['host-key-dialog-footer']}>
            <span className={styles['host-key-expiry']}>
              <Clock3 size={14} aria-hidden="true" />
              {t('hostKey.expiresAt', { time: formatExpiry(challenge.expires_at, i18n.language) })}
            </span>
            <div className={styles['host-key-dialog-actions']}>
              <Button
                className={['danger-button', styles['host-key-action'], styles['host-key-action-reject']].join(' ')}
                danger
                icon={<ShieldX size={16} />}
                disabled={decisionBusy}
                onClick={() => void decide('reject')}
              >
                {t('hostKey.reject')}
              </Button>
              <Button
                className={[
                  styles['host-key-action'],
                  changed ? styles['host-key-action-replace'] : 'primary-button',
                ].join(' ')}
                icon={changed ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                loading={decisionBusy}
                onClick={() => void decide(changed ? 'replace' : 'trust')}
              >
                {t(changed ? 'hostKey.replace' : 'hostKey.trust')}
              </Button>
            </div>
          </footer>
        </section>
      ) : null}
    </Modal>
  )
}

function AffectedWorkflows({
  challenge,
  hostNames,
}: {
  challenge: HostKeyChallenge
  hostNames: Map<string, string>
}) {
  const { t } = useTranslation()
  return (
    <div className={styles['host-key-workflows']}>
      <div className={styles['host-key-workflows-heading']}>
        <span>{t('hostKey.affectedWorkflows')}</span>
        <strong>{challenge.context_count}</strong>
      </div>
      <div className={styles['host-key-context-list']}>
        {challenge.contexts.map((context) => (
          <Tag key={contextKey(context)}>
            {t(`hostKey.consumer.${context.consumer_type}`)}
            <span>·</span>
            {t(`hostKey.role.${context.role}`)}
            {context.host_id && hostNames.get(context.host_id) ? <span>· {hostNames.get(context.host_id)}</span> : null}
          </Tag>
        ))}
        {challenge.context_count > challenge.contexts.length ? (
          <Tag>{t('hostKey.moreContexts', { count: challenge.context_count - challenge.contexts.length })}</Tag>
        ) : null}
      </div>
    </div>
  )
}

function Fingerprint({ value }: { value?: string }) {
  const { t } = useTranslation()
  return (
    <Typography.Text
      copyable={value ? { tooltips: [t('hostKey.copyFingerprint'), t('hostKey.fingerprintCopied')] } : false}
      className={styles['host-key-fingerprint']}
    >
      {value || '—'}
    </Typography.Text>
  )
}

function parseHostKeyEvent(value: string): HostKeyEvent | null {
  try {
    const event = JSON.parse(value) as HostKeyEvent
    if (!event || typeof event.instance_id !== 'string' || !Number.isSafeInteger(event.snapshot_revision)) {
      return null
    }
    return event
  } catch {
    return null
  }
}

function isReconciliationError(error: unknown) {
  return error instanceof TermousApiError && (
    error.code === 'HOST_KEY_CHALLENGE_STALE' ||
    error.code === 'HOST_KEY_CHALLENGE_EXPIRED' ||
    error.status === 404 ||
    error.status === 410
  )
}

function contextKey(context: HostKeyObservationContext) {
  return `${context.consumer_type}:${context.consumer_id}:${context.role}:${context.host_id ?? ''}`
}

function formatEndpoint(challenge: HostKeyChallenge) {
  const host = challenge.endpoint.canonical_host.includes(':')
    ? `[${challenge.endpoint.canonical_host}]`
    : challenge.endpoint.canonical_host
  return `${host}:${challenge.endpoint.port}`
}

function formatExpiry(value: string, locale: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : '—'
}
