import { LockKeyhole, ShieldCheck, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './AccountAuthStory.module.scss'

export function AccountAuthStory() {
  const { t } = useTranslation()
  return <aside className={styles.story}>
    <div className={styles.brand}><img src="./termous-icon.png" alt="" /><span>Termous</span></div>
    <div className={styles.intro}>
      <h2><span>{t('cloud.login.storyTitle')}</span><span>{t('cloud.login.storySubtitle')}</span></h2>
      <p>{t('cloud.syncHint')}</p>
    </div>
    <WorkspaceIllustration />
    <div className={styles.caption}>
      <ShieldCheck size={17} aria-hidden="true" />
      <div><strong>{t('cloud.login.storySecurity')}</strong><span>{t('cloud.login.syncChoice')}</span></div>
    </div>
  </aside>
}

function WorkspaceIllustration() {
  return <div className={styles.scene} aria-hidden="true">
    <div className={styles.grid} />
    <svg className={styles.connections} viewBox="0 0 360 240" fill="none">
      <path d="M176 157V199H303V158" />
      <circle cx="176" cy="157" r="3" /><circle cx="303" cy="158" r="3" />
    </svg>
    <div className={styles.terminal}>
      <div className={styles['terminal-bar']}><span className={styles.dots}><i /><i /><i /></span><span>workspace</span><Terminal size={12} /></div>
      <div className={styles['terminal-body']}>
        <span className={styles['terminal-path']}>termous <span>~</span></span>
        <div className={styles.command}><span>❯</span> ssh production</div>
        <div className={styles['code-lines']}><i /><i /><i /></div>
        <div className={styles.command}><span>❯</span><b /></div>
      </div>
    </div>
    <div className={styles.phone}>
      <div className={styles['phone-camera']} />
      <Terminal size={18} />
      <div className={styles['phone-lines']}><i /><i /><i /></div>
      <div className={styles['phone-home']} />
    </div>
    <div className={styles.lock}><LockKeyhole size={17} /></div>
  </div>
}
