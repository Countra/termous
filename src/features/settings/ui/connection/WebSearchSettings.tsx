import { Button, Input, Radio } from 'antd'
import { Cloud, Globe, Network, PlugZap } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsGatewayContext } from '#entities/settings'
import { FeedbackMessage } from '#shared/ui'
import type { WebSearchSettings as Value } from '#common/contracts'
import { useExtensionPreferences } from '../../model/useExtensionPreferences'
import { ExtensionPreferenceFeedback } from './ExtensionPreferenceFeedback'
import styles from './ExtensionPreferences.module.scss'

export function WebSearchSettings() {
  const { t } = useTranslation()
  const gateway = useContext(SettingsGatewayContext)
  const editor = useExtensionPreferences('web_search')
  const value = editor.value as unknown as Value | undefined
  const [test, setTest] = useState<{ busy: boolean; error?: string; success?: boolean }>({ busy: false })
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    pending.current?.abort()
    pending.current = null
    setTest({ busy: false })
    return () => { pending.current?.abort(); pending.current = null }
  }, [gateway, value?.mode, value?.base_url])
  const change = (patch: Partial<Value>) => { pending.current?.abort(); pending.current = null; editor.change(patch) }
  const testConnection = async () => {
    if (!gateway?.testWebSearch || pending.current || ['editing', 'saving', 'failed'].includes(editor.status)) return
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
  return <section className={styles.search} aria-label={t('webSearch.title')}>
    <header className={styles.heading}><span><Globe size={20} /></span><div><h3>{t('webSearch.title')}</h3><p>{t('webSearch.description')}</p></div></header>
    <Radio.Group className={styles.providers} aria-label={t('webSearch.mode')} value={value?.mode} disabled={editor.locked} onChange={event => {
      const mode = event.target.value as Value['mode']
      change({ mode })
      editor.commit()
    }}>
      <Radio value="cloud"><Cloud size={20} /><span><strong>{t('webSearch.cloud')}</strong><small>{t('webSearch.cloudHint')}</small></span></Radio>
      <Radio value="searxng"><Network size={20} /><span><strong>{t('webSearch.selfHosted')}</strong><small>{t('webSearch.selfHostedHint')}</small></span></Radio>
    </Radio.Group>
    {value?.mode === 'searxng' && <div className={styles.address}>
      <label htmlFor="WebSearchSettings-url">{t('webSearch.address')}</label>
      <Input id="WebSearchSettings-url" aria-describedby="WebSearchSettings-url-hint" value={value.base_url} disabled={editor.locked} placeholder="http://127.0.0.1:18088"
        onChange={event => change({ base_url: event.target.value })} onBlur={editor.commit} onPressEnter={event => event.currentTarget.blur()} />
      <p id="WebSearchSettings-url-hint">{t('webSearch.addressHint')}</p>
    </div>}
    <ExtensionPreferenceFeedback error={editor.error} reset={value ? editor.reset : undefined} retry={value ? editor.retry : () => { void editor.refresh() }} />
    <div className={styles.test}>
      <div><strong>{t('webSearch.verifyTitle')}</strong><p>{t('webSearch.testHint')}</p></div>
      <Button icon={<PlugZap size={15} />} disabled={editor.locked || ['editing', 'saving', 'failed'].includes(editor.status) || Boolean(editor.error) || !gateway?.testWebSearch} loading={test.busy} onClick={() => void testConnection()}>{t('webSearch.test')}</Button>
    </div>
    {test.error && <FeedbackMessage type="error" title={test.error} />}
    {test.success && <FeedbackMessage type="success" title={t('webSearch.testSuccess')} />}
    <aside className={styles.notes}><p>{t('webSearch.privacy')}</p></aside>
  </section>
}
