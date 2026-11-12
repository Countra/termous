import { Select } from 'antd'
import { Network } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { TransportPolicy } from '@termous/remote-protocol/connection-policy'
import { useExtensionPreferences } from '../../model/useExtensionPreferences'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import { ExtensionPreferenceFeedback } from './ExtensionPreferenceFeedback'
import styles from './RemoteConnectionSettings.module.scss'

export function RemoteConnectionSettings() {
  const { t } = useTranslation()
  const id = useId()
  const editor = useExtensionPreferences('remote_connection')
  const value = editor.value as { transport_policy: TransportPolicy } | undefined
  return <SettingsGroup title={t('settings.remoteConnectionTitle')} icon={<Network size={16} aria-hidden="true" />}>
    <SettingsField label={t('settings.remoteConnectionMode')} htmlFor={id}
      description={t('settings.remoteConnectionHint')} descriptionId={`${id}-hint`}
      control={<Select id={id} className={styles.select} aria-describedby={`${id}-hint`} value={value?.transport_policy}
        disabled={editor.locked || editor.status === 'saving'} loading={editor.loading || editor.status === 'saving'}
        options={[{ value: 'auto', label: t('settings.remoteConnectionAuto') }, { value: 'relay', label: t('settings.remoteConnectionRelay') }]}
        onChange={(transport_policy: TransportPolicy) => { editor.change({ transport_policy }); editor.commit() }} />} />
    <ExtensionPreferenceFeedback error={editor.error} retry={editor.retry} reset={value ? editor.reset : undefined} />
  </SettingsGroup>
}
