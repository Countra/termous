import { Button, Input, InputNumber } from 'antd'
import { FolderOpen, Package } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MCPIntegrationSettings as Value } from '#common/contracts'
import { SettingsGatewayContext } from '#entities/settings'
import { getTermousBridge } from '#shared/bridge'
import { FeedbackMessage } from '#shared/ui'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import { useExtensionPreferences } from '../../model/useExtensionPreferences'
import { ExtensionPreferenceFeedback } from './ExtensionPreferenceFeedback'
import styles from './ExtensionPreferences.module.scss'

export function MCPInstallationSettings() {
  const { t } = useTranslation()
  const gateway = useContext(SettingsGatewayContext)
  const editor = useExtensionPreferences('mcp_integrations')
  const value = editor.value as unknown as Value | undefined
  const { locked, change, commit } = editor
  const bridge = getTermousBridge()?.files
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState('')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    setPicking(false);setPickError('')
    return () => { pending.current?.abort();pending.current = null }
  }, [gateway])
  const pickDirectory = async () => {
    if (!bridge || locked || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setPicking(true);setPickError('')
    try {
      const selected = await bridge.pickDirectory()
      // 系统选择窗口无法中止；离开页面后忽略晚到结果，避免修改新页面的设置。
      if (!controller.signal.aborted && selected[0]) { change({ install_root: selected[0] });commit() }
    } catch (cause) {
      if (!controller.signal.aborted) setPickError(cause instanceof Error ? cause.message : t('extensions.failed'))
    } finally {
      if (pending.current === controller) { pending.current = null;setPicking(false) }
    }
  }
  return <div className={styles.installation} data-tour-busy={picking || ['editing', 'saving', 'failed'].includes(editor.status) || undefined}><SettingsGroup title={t('mcpPreparation.settingsTitle')} icon={<Package size={16} />}>
    <SettingsField htmlFor="MCPInstallationSettings-root" descriptionId="MCPInstallationSettings-root-description" label={t('mcpPreparation.root')} description={t('mcpPreparation.rootHint')}
      control={null}>
      <div className={styles.directory}>
        <Input id="MCPInstallationSettings-root" aria-describedby="MCPInstallationSettings-root-description" aria-label={t('mcpPreparation.root')} value={value?.install_root ?? ''} disabled={locked || picking} placeholder={t('mcpPreparation.defaultRoot')} onChange={event => change({ install_root: event.target.value })} onBlur={commit} onPressEnter={event => event.currentTarget.blur()} />
        <Button icon={<FolderOpen size={15} />} disabled={locked || !bridge} loading={picking} onClick={() => void pickDirectory()}>{t('extensions.chooseDirectory')}</Button>
      </div>
    </SettingsField>
    <SettingsField htmlFor="MCPInstallationSettings-installTimeout" descriptionId="MCPInstallationSettings-installTimeout-description" label={t('mcpPreparation.installTimeout')} description={t('mcpPreparation.installTimeoutHint')}
      control={<InputNumber id="MCPInstallationSettings-installTimeout" aria-describedby="MCPInstallationSettings-installTimeout-description" aria-label={t('mcpPreparation.installTimeout')} min={5} max={120} precision={0} value={value ? value.install_timeout_seconds / 60 : undefined} disabled={locked} onChange={minutes => { if (minutes != null) change({ install_timeout_seconds: minutes * 60 }) }} onBlur={commit} onStep={minutes => { change({ install_timeout_seconds: minutes * 60 }); commit() }} onPressEnter={event => event.currentTarget.blur()} />} />
    <SettingsField htmlFor="MCPInstallationSettings-startupTimeout" descriptionId="MCPInstallationSettings-startupTimeout-description" label={t('mcpPreparation.startupTimeout')} description={t('mcpPreparation.startupTimeoutHint')}
      control={<InputNumber id="MCPInstallationSettings-startupTimeout" aria-describedby="MCPInstallationSettings-startupTimeout-description" aria-label={t('mcpPreparation.startupTimeout')} min={15} max={300} precision={0} value={value?.startup_timeout_seconds} disabled={locked} onChange={seconds => { if (seconds != null) change({ startup_timeout_seconds: seconds }) }} onBlur={commit} onStep={seconds => { change({ startup_timeout_seconds: seconds }); commit() }} onPressEnter={event => event.currentTarget.blur()} />} />
  </SettingsGroup>
    {pickError && <FeedbackMessage type="error" title={pickError} onClose={() => setPickError('')} />}
    <ExtensionPreferenceFeedback error={editor.error} reset={value ? editor.reset : undefined} retry={value ? editor.retry : () => { void editor.refresh() }} />
  </div>
}
