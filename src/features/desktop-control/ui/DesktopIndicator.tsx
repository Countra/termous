import { useState } from 'react'
import { LoaderCircle, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesktopIndicatorBridge, DesktopIndicatorState } from '#common/contracts'
import { DesktopControlMark, desktopControlBadgeLabel, desktopControlLabel, desktopControlStyles } from '#entities/desktop-control'
import styles from './DesktopIndicator.module.scss'

export function DesktopIndicator({ state, bridge }: { state: DesktopIndicatorState; bridge: DesktopIndicatorBridge }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const control = state.control
  if (!control) return null
  const label = t(desktopControlLabel(control.source, control.active))
  if (state.role === 'badge') return <div className={`${desktopControlStyles.accent} ${styles.badge}`}>
    <DesktopControlMark source={control.source} size={15} /><span>{t(desktopControlBadgeLabel(control.source))}</span>
  </div>
  const target = control.target.kind === 'host_desktop'
    ? control.target.host.title || t('hostDesktop.localDesktop') : ''
  const detail = [control.source === 'agent' && control.target.kind === 'host_desktop' ? t('hostDesktop.localDesktop') : control.name, target]
    .filter((value, index, values) => value && values.indexOf(value) === index).join(' · ')
  const reclaim = async () => {
    if (busy) return
    setBusy(true)
    try { await bridge.reclaim({ instance_id: state.instance_id, target: control.target, reference: control.reference }) }
    // 原生主进程负责显示操作失败通知，浮层失效后仍能向用户反馈。
    catch { /* 失败反馈不依赖浮层继续可见。 */ }
    finally { setBusy(false) }
  }
  return <div className={`${desktopControlStyles.accent} ${desktopControlStyles.bar} ${styles.bar}`} role="status">
    <span className={desktopControlStyles.emblem}><DesktopControlMark source={control.source} size={20} /></span>
    <div className={styles.description}><strong title={label}>{label}</strong>{detail && <span title={detail}>{detail}</span>}</div>
    <button className={desktopControlStyles.reclaim} type="button" disabled={busy} aria-busy={busy} onClick={() => void reclaim()}>
      {busy ? <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /> : <Undo2 size={16} aria-hidden="true" />}
      {t('remoteDesktop.automation.reclaim')}
    </button>
  </div>
}
