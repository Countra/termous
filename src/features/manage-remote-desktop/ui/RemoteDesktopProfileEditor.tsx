import { Radio } from 'antd'
import { Check, Monitor, PanelsTopLeft } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { VNCProfileEditor } from '../protocols/vnc/VNCProfileEditor.tsx'
import { RDPProfileEditor } from '../protocols/rdp/RDPProfileEditor.tsx'
import {
  changeRemoteDesktopAccessProfileProtocol,
  type RemoteDesktopAccessProfileDraft,
  type RemoteDesktopAccessProfileDraftErrors,
} from '../model/remoteDesktopAccessProfileDraft.ts'
import type { DesktopProfileEditorOptions } from './profileEditorTypes.ts'
import styles from './RemoteDesktopProfileEditor.module.scss'

interface Props extends DesktopProfileEditorOptions {
  draft: RemoteDesktopAccessProfileDraft
  errors: RemoteDesktopAccessProfileDraftErrors
  onChange: (draft: RemoteDesktopAccessProfileDraft) => void
}

export function RemoteDesktopProfileEditor(props: Props) {
  const { t } = useTranslation()
  const protocolId = useId()
  const { draft, onChange, disabled } = props
  return (
    <div className={styles.editor}>
      <div className={styles.protocol}>
        <Radio.Group
          name={`${protocolId}-protocol`} className={styles.protocols}
          aria-label={t('remoteDesktop.rdp.protocol')}
          value={draft.protocol ?? 'vnc'} disabled={disabled}
          onChange={event => onChange(changeRemoteDesktopAccessProfileProtocol(draft, event.target.value))}
        >
          {(['vnc', 'rdp'] as const).map(protocol => (
            <Radio key={protocol} value={protocol} aria-label={protocol.toUpperCase()} className={styles.option}>
              <span className={styles['protocol-icon']} aria-hidden="true">
                {protocol === 'vnc' ? <PanelsTopLeft size={20} /> : <Monitor size={20} />}
              </span>
              <span className={styles.copy}>
                <strong>{protocol.toUpperCase()}</strong>
                <span>{t(`remoteDesktop.editor.${protocol}Description`)}</span>
              </span>
              <span className={styles.check} aria-hidden="true"><Check size={12} /></span>
            </Radio>
          ))}
        </Radio.Group>
      </div>
      {draft.protocol === 'rdp'
        ? <RDPProfileEditor {...props} draft={draft} onChange={onChange} />
        : <VNCProfileEditor {...props} draft={draft} onChange={onChange} />}
    </div>
  )
}
