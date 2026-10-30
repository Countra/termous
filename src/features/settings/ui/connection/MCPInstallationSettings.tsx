import { Alert, Button, Input, InputNumber, Space } from 'antd'
import { Package } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsModule } from '#entities/settings'
import type { MCPIntegrationSettings as Value } from '#common/contracts'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'

export function MCPInstallationSettings() {
  const { t } = useTranslation()
  const module = useSettingsModule('mcp_integrations', { refreshOnFocus: true })
  const [draft, setDraft] = useState<{ value: Value; revision: number }>()
  const value = draft?.value ?? module.snapshot?.value as unknown as Value | undefined
  const locked = module.busy || !module.available || !value
  const change = (patch: Partial<Value>) => {
    if (value && module.snapshot) setDraft({ value: { ...value, ...patch }, revision: draft?.revision ?? module.snapshot.revision })
  }
  const save = async () => {
    if (!draft) return
    const current = draft
    if (await module.update({ ...current.value }, current.revision)) setDraft(next => next === current ? undefined : next)
  }
  return <SettingsGroup title={t('mcpPreparation.settingsTitle')} icon={<Package size={16} />}>
    <SettingsField htmlFor="MCPInstallationSettings-root" descriptionId="MCPInstallationSettings-root-description" label={t('mcpPreparation.root')} description={t('mcpPreparation.rootHint')}
      control={<Input id="MCPInstallationSettings-root" aria-describedby="MCPInstallationSettings-root-description" aria-label={t('mcpPreparation.root')} value={value?.install_root ?? ''} disabled={locked} placeholder={t('mcpPreparation.defaultRoot')} onChange={event => change({ install_root: event.target.value })} />} />
    <SettingsField htmlFor="MCPInstallationSettings-installTimeout" descriptionId="MCPInstallationSettings-installTimeout-description" label={t('mcpPreparation.installTimeout')} description={t('mcpPreparation.installTimeoutHint')}
      control={<InputNumber id="MCPInstallationSettings-installTimeout" aria-describedby="MCPInstallationSettings-installTimeout-description" aria-label={t('mcpPreparation.installTimeout')} min={5} max={120} value={value ? value.install_timeout_seconds / 60 : undefined} disabled={locked} onChange={minutes => { if (minutes != null) change({ install_timeout_seconds: minutes * 60 }) }} />} />
    <SettingsField htmlFor="MCPInstallationSettings-startupTimeout" descriptionId="MCPInstallationSettings-startupTimeout-description" label={t('mcpPreparation.startupTimeout')} description={t('mcpPreparation.startupTimeoutHint')}
      control={<InputNumber id="MCPInstallationSettings-startupTimeout" aria-describedby="MCPInstallationSettings-startupTimeout-description" aria-label={t('mcpPreparation.startupTimeout')} min={15} max={300} value={value?.startup_timeout_seconds} disabled={locked} onChange={seconds => { if (seconds != null) change({ startup_timeout_seconds: seconds }) }} />} />
    {module.error && <Alert type="error" showIcon title={module.error.message} />}
    <Space><Button type="primary" disabled={locked || !draft} loading={module.busy} onClick={() => void save()}>{t('extensions.save')}</Button>
      <Button disabled={module.busy} onClick={() => { setDraft(undefined); void module.refresh() }}>{t('extensions.refresh')}</Button></Space>
  </SettingsGroup>
}
