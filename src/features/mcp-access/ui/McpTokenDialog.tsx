import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App as AntdApp, Button, Modal } from 'antd'
import { Check, Clipboard, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpClientToken } from '#entities/mcp-access'
import { getTermousBridge } from '#shared/bridge'
import { termousNotificationClassName } from '#shared/ui'
import styles from './McpTokenDialog.module.scss'

type CopyTarget = 'token' | 'config'

const initialCopyState: Record<CopyTarget, boolean> = {
  token: false,
  config: false,
}

export function McpTokenDialog({
  result,
  endpoint,
  onClose,
}: {
  result: McpClientToken | null
  endpoint: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [closing, setClosing] = useState(false)
  const [copying, setCopying] = useState<CopyTarget | null>(null)
  const [copied, setCopied] = useState(initialCopyState)
  const [copyAnnouncement, setCopyAnnouncement] = useState('')
  const closeFrameRef = useRef(0)
  const operationRef = useRef(0)
  const feedbackTimersRef = useRef<Partial<Record<CopyTarget, number>>>({})
  const visibleResult = closing ? null : result
  const config = useMemo(() => visibleResult ? JSON.stringify({
    mcpServers: {
      termous: {
        type: 'http',
        url: endpoint,
        headers: { Authorization: `Bearer ${visibleResult.token}` },
      },
    },
  }, null, 2) : '', [endpoint, visibleResult])

  useEffect(() => () => {
    operationRef.current += 1
    window.cancelAnimationFrame(closeFrameRef.current)
    for (const timer of Object.values(feedbackTimersRef.current)) {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  const resetCopyFeedback = () => {
    for (const timer of Object.values(feedbackTimersRef.current)) {
      if (timer !== undefined) window.clearTimeout(timer)
    }
    feedbackTimersRef.current = {}
    setCopied(initialCopyState)
    setCopyAnnouncement('')
  }

  const close = () => {
    operationRef.current += 1
    resetCopyFeedback()
    setCopying(null)
    setClosing(true)
    window.cancelAnimationFrame(closeFrameRef.current)
    closeFrameRef.current = window.requestAnimationFrame(() => {
      onClose()
      setClosing(false)
    })
  }

  const copy = async (target: CopyTarget, value: string) => {
    const operation = operationRef.current
    setCopying(target)
    try {
      await copyText(value)
      if (operation !== operationRef.current) return
      const announcement = target === 'token'
        ? t('settings.mcp.tokenCopied')
        : t('settings.mcp.configCopied')
      setCopied((current) => ({ ...current, [target]: true }))
      setCopyAnnouncement(announcement)
      const previousTimer = feedbackTimersRef.current[target]
      if (previousTimer !== undefined) window.clearTimeout(previousTimer)
      feedbackTimersRef.current[target] = window.setTimeout(() => {
        setCopied((current) => ({ ...current, [target]: false }))
        setCopyAnnouncement((current) => current === announcement ? '' : current)
        delete feedbackTimersRef.current[target]
      }, 1800)
    } catch {
      if (operation !== operationRef.current) return
      notification.error({
        title: t('settings.mcp.operationFailed'),
        duration: 4,
        className: termousNotificationClassName,
      })
    } finally {
      if (operation === operationRef.current) setCopying(null)
    }
  }

  return (
    <Modal
      open={Boolean(result)}
      centered
      width={640}
      rootClassName={styles['token-modal-root']}
      title={(
        <div className={styles['token-title']}>
          <span aria-hidden="true"><KeyRound size={17} /></span>
          <div>
            <strong>{t('settings.mcp.tokenTitle')}</strong>
            {result?.client.name ? <small>{result.client.name}</small> : null}
          </div>
        </div>
      )}
      footer={(
        <Button type="primary" disabled={closing} onClick={close}>
          {t('settings.mcp.tokenSaved')}
        </Button>
      )}
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      destroyOnHidden
    >
      {visibleResult ? (
        <div className={styles['token-dialog']}>
          <Alert
            className={styles['token-notice']}
            type="warning"
            showIcon
            title={t('settings.mcp.tokenOnce')}
          />

          <section className={styles['credential-section']} aria-labelledby="mcp-token-value-title">
            <h3 id="mcp-token-value-title">{t('settings.mcp.tokenValue')}</h3>
            <div className={styles['secret-control']}>
              <code>{visibleResult.token}</code>
              <Button
                type="text"
                className={copied.token ? styles['is-copied'] : ''}
                icon={copied.token ? <Check size={15} /> : <Clipboard size={15} />}
                loading={copying === 'token'}
                disabled={copying !== null && copying !== 'token'}
                aria-label={t('settings.mcp.copyTokenLabel')}
                onClick={() => void copy('token', visibleResult.token)}
              >
                {copied.token ? t('settings.mcp.copied') : t('app.copy')}
              </Button>
            </div>
          </section>

          <section className={styles['credential-section']} aria-labelledby="mcp-client-config-title">
            <header className={styles['config-heading']}>
              <h3 id="mcp-client-config-title">{t('settings.mcp.clientConfig')}</h3>
              <Button
                type="text"
                className={copied.config ? styles['is-copied'] : ''}
                icon={copied.config ? <Check size={15} /> : <Clipboard size={15} />}
                loading={copying === 'config'}
                disabled={copying !== null && copying !== 'config'}
                aria-label={t('settings.mcp.copyConfigLabel')}
                onClick={() => void copy('config', config)}
              >
                {copied.config ? t('settings.mcp.copied') : t('app.copy')}
              </Button>
            </header>
            <pre tabIndex={0} aria-labelledby="mcp-client-config-title">{config}</pre>
          </section>

          <span className={styles['copy-status']} aria-live="polite" aria-atomic="true">
            {copyAnnouncement}
          </span>
        </div>
      ) : null}
    </Modal>
  )
}

async function copyText(value: string) {
  const bridge = getTermousBridge()
  if (bridge?.clipboard) {
    await bridge.clipboard.writeText(value)
    return
  }
  await navigator.clipboard.writeText(value)
}
