import { Segmented } from 'antd'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopProtocol } from '#entities/remote-desktop'
import { VNCProfileEditor } from '../protocols/vnc/VNCProfileEditor.tsx'
import { RDPProfileEditor } from '../protocols/rdp/RDPProfileEditor.tsx'
import {
  changeRemoteDesktopAccessProfileProtocol,
  type RemoteDesktopAccessProfileDraft,
  type RemoteDesktopAccessProfileDraftErrors,
} from '../model/remoteDesktopAccessProfileDraft.ts'
import styles from '../protocols/vnc/VNCProfileEditor.module.scss'
import segmentedStyles from '../protocols/vnc/VNCProfileSegmented.module.scss'
import protocolStyles from './RemoteDesktopProfileEditor.module.scss'

type Props = Omit<ComponentProps<typeof VNCProfileEditor>, 'draft' | 'onChange' | 'errors'> & {
  draft: RemoteDesktopAccessProfileDraft
  errors: RemoteDesktopAccessProfileDraftErrors
  onChange: (draft: RemoteDesktopAccessProfileDraft) => void
}

export function RemoteDesktopProfileEditor(props: Props) {
  const { t } = useTranslation()
  const { draft, onChange, disabled } = props
  return (
    <div className={styles.form}>
      <div className={protocolStyles.protocol}>
        <div className={`${styles['section-inner']} ${styles['route-setting']}`}>
          <span className={styles['route-label']}>{t('remoteDesktop.rdp.protocol')}</span>
          <Segmented<RemoteDesktopProtocol>
            block
            className={segmentedStyles.control}
            aria-label={t('remoteDesktop.rdp.protocol')}
            value={draft.protocol ?? 'vnc'}
            disabled={disabled}
            options={['VNC', 'RDP'].map((label) => ({ value: label.toLowerCase() as RemoteDesktopProtocol, label }))}
            onChange={(protocol) => onChange(changeRemoteDesktopAccessProfileProtocol(draft, protocol))}
          />
        </div>
      </div>
      {draft.protocol === 'rdp'
        ? <RDPProfileEditor {...props} draft={draft} onChange={onChange} />
        : <VNCProfileEditor {...props} draft={draft} onChange={onChange} />}
    </div>
  )
}
