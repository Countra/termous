import type { ReactNode } from 'react'
import { Button } from 'antd'
import { ArrowRight, KeyRound, Monitor, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './AccountLoginLayout.module.scss'

interface Props {
  busy: boolean
  onUseOffline: () => void
  securityAction?: ReactNode
  children: ReactNode
}

export function AccountLoginLayout({ busy, onUseOffline, securityAction, children }: Props) {
  const { t } = useTranslation()
  return <div className={styles.page} data-tour="account-workspace">
    <section className={styles.surface} aria-label={t('cloud.signInAccount')}>
      <div className={styles.story}>
        <div className={styles.brand}><img src="./termous-icon.png" alt="" /><span>Termous</span></div>
        <div className={styles.intro}>
          <h1><span>{t('cloud.login.storyTitle')}</span><span>{t('cloud.login.storySubtitle')}</span></h1>
          <p>{t('cloud.syncHint')}</p>
        </div>
        <ConnectionIllustration />
        <ul className={styles.features}>
          <li><span className={styles['feature-icon']}><ShieldCheck size={19} aria-hidden="true" /></span><div><strong>{t('cloud.login.trustTitle')}</strong><p>{t('cloud.login.trustHint')}</p></div></li>
          <li><span className={styles['feature-icon']}><KeyRound size={19} aria-hidden="true" /></span><div><strong>{t('cloud.login.encryptionTitle')}</strong><p>{t('cloud.login.encryptionHint')}</p></div></li>
        </ul>
        <p className={styles.caption}>{t('cloud.login.scopeHint')}</p>
      </div>
      <div className={styles.access}>
        <header className={styles['access-header']}><span>{t('nav.account')}</span>{securityAction}</header>
        <div className={styles.content}>{children}</div>
        <footer className={styles.offline}>
          <span>{t('cloud.login.offlineLabel')}</span>
          <Button type="text" icon={<Monitor size={15} aria-hidden="true" />} disabled={busy} onClick={onUseOffline}>{t('cloud.useOffline')}<ArrowRight size={14} aria-hidden="true" /></Button>
        </footer>
      </div>
    </section>
  </div>
}

function ConnectionIllustration() {
  return <svg className={styles.illustration} viewBox="0 0 320 172" fill="none" aria-hidden="true">
    <path className={styles.connector} d="M181 76H219V102H246" strokeWidth="1.5" strokeDasharray="4 5" />
    <rect className={styles.device} x="14" y="20" width="168" height="110" rx="12" />
    <path className={styles.outline} d="M14 46H182M76 130V145M120 130V145M64 148H132" strokeLinecap="round" />
    <circle className={styles.dot} cx="29" cy="33" r="2.5" /><circle className={styles.dot} cx="40" cy="33" r="2.5" /><circle className={styles.dot} cx="51" cy="33" r="2.5" />
    <path className={styles.prompt} d="M30 65L35 69L30 73M41 74H48" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path className={styles.line} d="M57 69H134M30 87H106M30 103H84" strokeWidth="4" strokeLinecap="round" />
    <path className={styles.prompt} d="M118 87H150M96 103H133" strokeWidth="4" strokeLinecap="round" />
    <rect className={styles.device} x="246" y="57" width="57" height="92" rx="11" />
    <path className={styles.outline} d="M264 65H285M269 140H280" strokeWidth="2" strokeLinecap="round" />
    <rect className={styles.mobile} x="256" y="84" width="37" height="31" rx="5" />
    <path className={styles.prompt} d="M265 94H284M265 104H277" strokeWidth="2" strokeLinecap="round" />
    <circle className={styles['lock-surface']} cx="219" cy="76" r="17" />
    <rect className={styles.prompt} x="213" y="74" width="12" height="10" rx="2" strokeWidth="1.5" />
    <path className={styles.prompt} d="M215 74V71a4 4 0 018 0v3M219 78V80" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
}
