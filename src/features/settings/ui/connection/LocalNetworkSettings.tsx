import { Alert, Button, Input, Space, Switch } from 'antd'
import { Network } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsModule } from '#entities/settings'
import type { LocalNetworkSettings as Value } from '#common/contracts'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'

export function LocalNetworkSettings() {
  const { t } = useTranslation()
  const module = useSettingsModule('local_network', { refreshOnFocus: true })
  const [bypassText, setBypassText] = useState<string>()
  const [draft, setDraft] = useState<{ value: Value; revision: number }>()
  const saved = module.snapshot?.value as unknown as Value | undefined
  const value = draft?.value ?? saved
  const locked = module.busy || !module.available || !value
  const change = (patch: Partial<Value>) => {
    if (value && module.snapshot) setDraft({ value: { ...value, ...patch }, revision: draft?.revision ?? module.snapshot.revision })
  }
  const save = async () => {
    if (!draft) return
    const current = draft
    if (await module.update({ ...current.value }, current.revision)) { setDraft(next => next === current ? undefined : next); setBypassText(undefined) }
  }
  return <SettingsGroup title={t('mcpPreparation.network.title')} icon={<Network size={16} />}>
    <SettingsField htmlFor="LocalNetworkSettings-enabled" descriptionId="LocalNetworkSettings-enabled-description" label={t('mcpPreparation.network.enabled')} description={t('mcpPreparation.network.scope')}
      control={<Switch id="LocalNetworkSettings-enabled" aria-describedby="LocalNetworkSettings-enabled-description" aria-label={t('mcpPreparation.network.enabled')} checked={value?.enabled ?? false} disabled={locked} onChange={enabled => change({ enabled })} />} />
    <SettingsField htmlFor="LocalNetworkSettings-url" descriptionId="LocalNetworkSettings-url-description" label={t('mcpPreparation.network.url')} description={t('mcpPreparation.network.urlHint')}
      control={<Input id="LocalNetworkSettings-url" aria-describedby="LocalNetworkSettings-url-description" aria-label={t('mcpPreparation.network.url')} value={value?.url ?? ''} disabled={locked} placeholder="http://127.0.0.1:7890" onChange={event => change({ url: event.target.value })} />} />
    <SettingsField htmlFor="LocalNetworkSettings-bypass" descriptionId="LocalNetworkSettings-bypass-description" label={t('mcpPreparation.network.bypass')} description={t('mcpPreparation.network.bypassHint')}
      control={<Input.TextArea id="LocalNetworkSettings-bypass" aria-describedby="LocalNetworkSettings-bypass-description" aria-label={t('mcpPreparation.network.bypass')} value={bypassText ?? value?.bypass.join('\n') ?? ''} disabled={locked} autoSize={{ minRows: 2, maxRows: 5 }} onChange={event => { setBypassText(event.target.value); change({ bypass: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) }) }} />} />
    <p>{t('mcpPreparation.network.limit')}</p>
    {module.error && <Alert type="error" showIcon title={module.error.message} />}
    <Space><Button type="primary" disabled={locked || !draft} loading={module.busy} onClick={() => void save()}>{t('extensions.save')}</Button>
    <Button disabled={module.busy} onClick={() => { setDraft(undefined); setBypassText(undefined); void module.refresh() }}>{t('extensions.refresh')}</Button></Space>
  </SettingsGroup>
}
