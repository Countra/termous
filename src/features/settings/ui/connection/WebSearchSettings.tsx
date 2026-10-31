import { Alert, Button, Input, Select, Space } from 'antd'
import { Globe } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsGatewayContext, useSettingsModule } from '#entities/settings'
import type { WebSearchSettings as Value } from '#common/contracts'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'

export function WebSearchSettings() {
  const { t } = useTranslation()
  const gateway = useContext(SettingsGatewayContext)
  const module = useSettingsModule('web_search', { refreshOnFocus: true })
  const [draft, setDraft] = useState<{ value: Value; revision: number }>()
  const [test, setTest] = useState<{ busy: boolean; error?: string; success?: boolean }>({ busy: false })
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const value = draft?.value ?? module.snapshot?.value as unknown as Value | undefined
  const locked = module.busy || test.busy || !module.available || !value
  const change = (patch: Partial<Value>) => {
    if (value && module.snapshot) {
      setDraft({ value: { ...value, ...patch }, revision: draft?.revision ?? module.snapshot.revision })
      setTest({ busy: false })
    }
  }
  const save = async () => {
    if (!draft) return
    const current = draft
    if (await module.update({ ...current.value }, current.revision)) setDraft(next => next === current ? undefined : next)
  }
  const testConnection = async () => {
    if (!gateway?.testWebSearch || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setTest({ busy: true })
    try {
      await gateway.testWebSearch(controller.signal)
      if (!controller.signal.aborted) setTest({ busy: false, success: true })
    } catch (cause) {
      if (!controller.signal.aborted) setTest({ busy: false, error: cause instanceof Error ? cause.message : String(cause) })
    } finally { if (pending.current === controller) pending.current = null }
  }
  return <SettingsGroup title={t('webSearch.title')} icon={<Globe size={16} />}>
    <SettingsField htmlFor="WebSearchSettings-mode" descriptionId="WebSearchSettings-mode-description" label={t('webSearch.mode')} description={t('webSearch.privacy')}
      control={<Select id="WebSearchSettings-mode" aria-describedby="WebSearchSettings-mode-description" aria-label={t('webSearch.mode')} disabled={locked} value={value?.mode}
        options={[{ value: 'cloud', label: t('webSearch.cloud') }, { value: 'searxng', label: t('webSearch.selfHosted') }]}
        onChange={(mode: Value['mode']) => change({ mode })} />} />
    {value?.mode === 'searxng' && <SettingsField htmlFor="WebSearchSettings-url" descriptionId="WebSearchSettings-url-description" label={t('webSearch.address')} description={t('webSearch.addressHint')}
      control={<Input id="WebSearchSettings-url" aria-describedby="WebSearchSettings-url-description" aria-label={t('webSearch.address')} value={value.base_url} disabled={locked}
        placeholder="http://127.0.0.1:18088" onChange={event => change({ base_url: event.target.value })} />} />}
    <p>{t('webSearch.connectionHint')}</p>
    {module.error && <Alert type="error" showIcon title={module.error.message} />}
    {test.error && <Alert type="error" showIcon title={test.error} />}
    {test.success && <Alert type="success" showIcon title={t('webSearch.testSuccess')} />}
    <Space>
      <Button type="primary" disabled={locked || !draft} loading={module.busy} onClick={() => void save()}>{t('extensions.save')}</Button>
      <Button disabled={locked || Boolean(draft) || !gateway?.testWebSearch} loading={test.busy} onClick={() => void testConnection()}>{t('webSearch.test')}</Button>
      <Button disabled={module.busy || test.busy} onClick={() => { setDraft(undefined); setTest({ busy: false }); void module.refresh() }}>{t('extensions.refresh')}</Button>
    </Space>
    <p>{t('webSearch.testHint')}</p>
  </SettingsGroup>
}
