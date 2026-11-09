import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Button, QRCode, Spin } from 'antd'
import { CheckCircle2, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import type { CloudQRLogin, CloudQRLoginInput } from '#common/contracts'
import styles from './AccountQRLogin.module.scss'
import { cloudOperationErrorCode } from '../model/useCloudOperationFeedback'

const pending = (state?: string) => ['pending', 'scanned', 'preparing', 'ready'].includes(state ?? '')

export function AccountQRLogin({ api, generation, reauthenticate }: { api: CloudGateway; generation: string; reauthenticate: boolean }) {
  const { t, i18n } = useTranslation()
  const status = useSyncExternalStore(api.subscribeStatus, api.getStatus)
  const [initial, setInitial] = useState<CloudQRLogin>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(performance.now())
  const attached = useRef(false)
  const lifetime = useRef<symbol | undefined>(undefined)
  const item = status?.generation === generation ? status.qr_login ?? initial : undefined
  // 同一状态随其他账号事件重复发布时，不重置剩余时长。
  const observed = useMemo(() => ({ id: item?.id, revision: item?.revision, expiresAt: item?.expires_at, seconds: item?.remaining_seconds ?? 0, at: performance.now() }), [item?.id, item?.revision, item?.remaining_seconds, item?.expires_at])
  const itemRef = useRef(item)
  useEffect(() => { itemRef.current = item; setNow(performance.now()) }, [item])
  const release = useCallback((value?: CloudQRLogin) => {
    const snapshot = api.getStatus()
    if (snapshot?.generation !== generation) return
    const latest = snapshot.qr_login
    if (value && latest && latest.id !== value.id) return
    const target = latest ?? value
    if (!target) return
    // 卸载后无界面接收错误；Core 会暂停未批准流程，远端最终由期限收敛。
    void api.qrLogin({ generation, action: pending(target.state) ? 'cancel' : 'watch', id: target.id, watching: false }).catch(() => {})
  }, [api, generation])
  useEffect(() => {
    attached.current = true
    const scope = Symbol('qr-login')
    lifetime.current = scope
    let disposed = false
    let received: CloudQRLogin | undefined
    const fail = (e: unknown) => {
      if (!disposed) setError(cloudOperationErrorCode(e, () => false))
      else if (!attached.current) release(received)
    }
    setError(''); setInitial(undefined)
    queueMicrotask(() => {
      if (disposed) return
      setBusy(true)
      void api.qrLogin({ generation, action: 'create', reauthenticate }).then(next => {
        received = next
        if (disposed) {
          if (!attached.current) release(next)
          return
        }
        itemRef.current = next
        setInitial(next); setNow(performance.now())
        if (document.hidden) void api.qrLogin({ generation, action: 'watch', id: next.id, watching: false }).catch(fail)
      }).catch(fail).finally(() => { if (!disposed) setBusy(false) })
    })
    const visibility = () => {
      const value = itemRef.current
      if (value) void api.qrLogin({ generation, action: 'watch', id: value.id, watching: !document.hidden }).catch(fail)
    }
    document.addEventListener('visibilitychange', visibility)
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => {
      disposed = true; attached.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility)
      queueMicrotask(() => {
        if (!attached.current) release(itemRef.current ?? received)
      })
    }
  }, [api, generation, reauthenticate, release])
  const act = async (action: CloudQRLoginInput['action']) => {
    if (busy) return
    const scope = lifetime.current
    const current = () => attached.current && lifetime.current === scope && api.getStatus()?.generation === generation
    setBusy(true); setError('')
    try {
      const next = await api.qrLogin({ generation, action, id: item?.id, reauthenticate })
      if (current()) {
        itemRef.current = next; setInitial(next); setNow(performance.now())
        if (document.hidden) await api.qrLogin({ generation, action: 'watch', id: next.id, watching: false })
      }
      else if (!attached.current) release(next)
    }
    catch (e) {
      if (current()) setError(cloudOperationErrorCode(e, value => i18n.exists(`cloud.errors.${value}`)))
      else if (!attached.current) release()
    }
    finally { if (current()) setBusy(false) }
  }
  const remaining = item ? Math.max(0, Math.ceil((observed.seconds * 1000 - Math.max(0, now - observed.at)) / 1000)) : 0
  const completed = item?.state === 'completed'
  const timedOut = !!item && pending(item.state) && remaining === 0
  const terminal = !!item && (!pending(item.state) && !['approved', 'issued', 'completed'].includes(item.state) || timedOut)
  const scanned = !!item && !terminal && item.state !== 'pending'
  const state = timedOut ? 'expired' : item?.state ?? 'loading'
  const code = error || item?.error_code
  const showCode = Boolean(item?.qr_code && !terminal && !scanned)
  const hint = completed ? 'completedHint' : terminal ? 'refreshHint' : ['approved', 'issued'].includes(state) ? 'completingHint' : scanned ? 'confirmHint' : 'hint'
  return <div className={`${styles.panel}${scanned || terminal ? ` ${styles.compact}` : ''}`}>
    <div className={`${styles.code} ${showCode ? styles['has-code'] : ''} ${scanned || terminal ? styles['status-icon'] : ''}`}>
      {showCode && item?.qr_code ? <QRCode size={208} value={item.qr_code} color="#0F1116" bgColor="#FFFFFF" bordered={false} /> : <div className={styles.placeholder}>{terminal ? <Smartphone size={40} aria-hidden="true" /> : scanned ? <CheckCircle2 size={40} aria-hidden="true" /> : <Spin size="large" />}</div>}
    </div>
    <div className={styles.details}>
      <div className={styles.status}><strong role="status">{t(`cloud.qr.${state}`)}</strong><p>{t(`cloud.qr.${hint}`)}</p>
        {item && !terminal && pending(item.state) && <small>{t('cloud.qr.remaining', { seconds: remaining })}</small>}
      </div>
      {scanned && !completed && <div className={styles.pair}><span>{t('cloud.qr.checkCode')}</span><strong>{item.pairing_code}</strong></div>}
      {code && <Alert showIcon type="error" title={t(i18n.exists(`cloud.errors.${code}`) ? `cloud.errors.${code}` : 'cloud.errors.local_failed')} />}
      {terminal ? <Button type="primary" block loading={busy} onClick={() => void act('create')}>{t('cloud.qr.refresh')}</Button> : code && <Button block loading={busy} onClick={() => void act(item ? 'retry' : 'create')}>{t('cloud.qr.retry')}</Button>}
    </div>
  </div>
}
