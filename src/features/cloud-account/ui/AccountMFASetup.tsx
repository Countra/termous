import { useEffect, useRef, useState } from 'react'
import { Button, QRCode } from 'antd'
import { Check, ChevronRight, ClipboardCopy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudMFASetup } from '#common/contracts'
import styles from './AccountMFA.module.scss'

interface Props { setup: CloudMFASetup; disabled: boolean; onCopyError: () => void }

export function AccountMFASetup({ setup, disabled, onCopyError }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const lifetime = useRef<{ active: boolean } | null>(null)
  useEffect(() => {
    // 复制结果可能晚于取消或申请替换，反馈只能归属于原绑定步骤。
    const scope = { active: true }
    lifetime.current = scope; setCopied(false)
    return () => { scope.active = false }
  }, [setup])
  const copy = async () => {
    const scope = lifetime.current
    try {
      await navigator.clipboard.writeText(setup.secret)
      if (scope?.active) setCopied(true)
    } catch {
      if (scope?.active) onCopyError()
    }
  }
  return <div className={styles['setup-details']}>
    <div className={styles.setup}>
      <div className={styles['qr-frame']}>
        <QRCode type="svg" value={setup.otpauth_uri} size={208} marginSize={4} bordered={false} bgColor="#fff" color="#111" />
      </div>
      <div className={styles['setup-copy']}>
        <h3>{t('cloud.mfa.scanTitle')}</h3>
      </div>
    </div>
    <details className={styles['manual-key']}>
      <summary><ChevronRight size={16} aria-hidden="true" /><span>{t('cloud.mfa.manualKey')}</span></summary>
      <div className={styles['manual-content']}>
        <p>{t('cloud.mfa.manualHint')}</p>
        <div className={styles['secret-box']}>
          <div className={styles['secret-heading']}>
            <span>{t('cloud.mfa.secretLabel')}</span>
            <Button type="text" size="small" disabled={disabled} icon={copied ? <Check size={14} /> : <ClipboardCopy size={14} />} onClick={() => void copy()}>
              <span aria-live="polite">{t(copied ? 'cloud.mfa.copied' : 'cloud.mfa.copyKey')}</span>
            </Button>
          </div>
          <code>{setup.secret}</code>
        </div>
      </div>
    </details>
  </div>
}
