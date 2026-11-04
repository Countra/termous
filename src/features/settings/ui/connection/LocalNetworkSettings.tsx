import { Button, Input, Switch, Tooltip, type InputRef } from 'antd'
import { Info, Network } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocalNetworkSettings as Value } from '#common/contracts'
import { FeedbackMessage } from '#shared/ui'
import { useExtensionPreferences } from '../../model/useExtensionPreferences'
import { SettingsGroup } from '../controls/SettingsGroup'
import { ExtensionPreferenceFeedback } from './ExtensionPreferenceFeedback'
import styles from './LocalNetworkSettings.module.scss'

const sameEntries = (left: string[], right: string[]) => left.length === right.length && left.every((entry, index) => entry === right[index])

export function LocalNetworkSettings() {
  const { t } = useTranslation()
  const editor = useExtensionPreferences('local_network')
  const value = editor.value as unknown as Value | undefined
  const id = useId()
  const addressRef = useRef<InputRef>(null)
  const [addressRequired, setAddressRequired] = useState(false)
  const [bypassDraft, setBypassDraft] = useState<{ value: string[]; text: string }>()
  const bypassText = bypassDraft && value && sameEntries(bypassDraft.value, value.bypass) ? bypassDraft.text : value?.bypass.join('\n')
  const commitAddress = () => {
    if (!value) return
    if (value.enabled && !value.url.trim()) { setAddressRequired(true); return }
    editor.commit()
  }
  const changeBypass = (text: string) => {
    if (!value) return
    const entries = text.split('\n').map(line => line.trim()).filter(Boolean)
    // 保留正在输入的换行；内容未变化时复用数组，避免产生无效提交。
    const bypass = sameEntries(entries, value.bypass) ? value.bypass : entries
    setBypassDraft({ value: bypass, text })
    editor.change({ bypass })
  }
  return <div className={styles.root}>
    <SettingsGroup title={t('mcpPreparation.network.title')} icon={<Network size={16} aria-hidden="true" />}>
      <div className={styles.toggle}>
        <div className={styles.copy}>
          <div className={styles.label}>
            <label htmlFor={`${id}-enabled`}>{t('mcpPreparation.network.enabled')}</label>
            <Tooltip trigger={['hover', 'focus']} title={<div className={styles.help}>
              <p>{t('mcpPreparation.network.scope')}</p>
              <p>{t('mcpPreparation.network.override')}</p>
              <p>{t('mcpPreparation.network.limit')}</p>
            </div>}>
              <Button type="text" size="small" aria-label={t('mcpPreparation.network.details')} icon={<Info size={14} aria-hidden="true" />} />
            </Tooltip>
          </div>
          <p id={`${id}-scope`}>{t('mcpPreparation.network.summary')}</p>
        </div>
        <Switch id={`${id}-enabled`} aria-describedby={`${id}-scope`} checked={value?.enabled ?? false} disabled={editor.locked}
          loading={editor.status === 'saving'} onChange={enabled => {
            if (enabled && !value?.url.trim()) { setAddressRequired(true); addressRef.current?.focus(); return }
            setAddressRequired(false)
            editor.change({ enabled })
            editor.commit()
          }} />
      </div>
      <div className={styles.fields}>
        <div className={styles.field}>
          <div className={styles.copy}>
            <label htmlFor={`${id}-url`}>{t('mcpPreparation.network.url')}</label>
            <p id={`${id}-url-hint`}>{t('mcpPreparation.network.urlHint')}</p>
          </div>
          <Input ref={addressRef} id={`${id}-url`} aria-describedby={`${id}-url-hint`} value={value?.url ?? ''}
            disabled={editor.locked} placeholder="http://127.0.0.1:7890" spellCheck={false} autoComplete="off"
            onChange={event => { setAddressRequired(false); editor.change({ url: event.target.value }) }}
            onBlur={commitAddress} onPressEnter={event => event.currentTarget.blur()} />
        </div>
        <div className={styles.field}>
          <div className={styles.copy}>
            <label htmlFor={`${id}-bypass`}>{t('mcpPreparation.network.bypass')}</label>
            <p>{t('mcpPreparation.network.bypassSummary')}</p>
          </div>
          <div className={styles.control}>
            <Input.TextArea id={`${id}-bypass`} aria-describedby={`${id}-bypass-hint`} value={bypassText ?? ''}
              disabled={editor.locked} autoSize={{ minRows: 2, maxRows: 5 }} spellCheck={false}
              placeholder={'example.com\n192.168.1.10:8080'}
              onChange={event => changeBypass(event.target.value)} onBlur={editor.commit} />
            <p id={`${id}-bypass-hint`}>{t('mcpPreparation.network.bypassHint')}</p>
          </div>
        </div>
      </div>
    </SettingsGroup>
    {addressRequired && <FeedbackMessage type="warning" title={t('mcpPreparation.network.urlRequired')} onClose={() => setAddressRequired(false)} />}
    <ExtensionPreferenceFeedback error={editor.error} retry={editor.retry} reset={value ? () => {
      setAddressRequired(false); setBypassDraft(undefined); editor.reset()
    } : undefined} />
  </div>
}
