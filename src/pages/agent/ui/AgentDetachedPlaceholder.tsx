import { Button } from 'antd'
import { AppWindow, ArrowUpRight, CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Ref } from 'react'
import styles from './AgentWindow.module.scss'

export function AgentDetachedPlaceholder({ ref, capture, busy, restoring, onReturn, onFocus }: {
  ref?: Ref<HTMLElement>; capture?: string; busy: boolean; restoring: boolean; onReturn: () => void; onFocus: () => void
}) {
  const { t } = useTranslation()
  return <section ref={ref} className={styles.placeholder} data-motion={restoring ? 'leaving' : 'entering'}
    inert={restoring} aria-label={t('agent.window.detached')}>
    {capture ? <img className={styles.capture} src={capture} alt="" aria-hidden="true" /> : <div className={styles.fallback} aria-hidden="true"><aside /><main><i /><i /><i /></main></div>}
    <div className={styles.scrim} />
    <div className={styles.card}>
      <span className={styles.mark}><AppWindow size={23} /></span>
      <h2>{t('agent.window.detached')}</h2><p>{t('agent.window.detachedDescription')}</p>
      <div className={styles.actions}>
        <Button type="primary" icon={<CornerDownLeft size={15} />} loading={busy} onClick={onReturn}>{t('agent.window.returnHere')}</Button>
        <Button icon={<ArrowUpRight size={15} />} onClick={onFocus}>{t('agent.window.focus')}</Button>
      </div>
    </div>
  </section>
}
