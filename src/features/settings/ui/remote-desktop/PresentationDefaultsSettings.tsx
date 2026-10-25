import { Alert, Button } from 'antd'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DesktopQualityDefaultsEditor } from '#entities/remote-desktop'
import { usePresentationDefaultsEditor } from '../../model/usePresentationDefaultsEditor'
import { SettingsGroup } from '../controls/SettingsGroup'
import styles from './PresentationDefaultsSettings.module.scss'

export function PresentationDefaultsSettings({ disabled = false }: { disabled?: boolean }) {
  const editor = usePresentationDefaultsEditor(disabled)
  const { i18n } = useTranslation()
  const text = (cn: string, en: string) => i18n?.language?.startsWith('zh') ? cn : en
  return <SettingsGroup title={text('默认显示设置', 'Default display settings')} icon={<Settings2 size={16} aria-hidden="true" />}>
    {editor.loadFailed && <div className={styles.alert}><Alert showIcon type="warning" title={text('无法加载默认设置，请稍后重试。', 'Could not load defaults. Please try again later.')} /></div>}
    {editor.status === 'failed' && <div className={styles.alert}><Alert showIcon type="error"
      title={text('保存失败，修改已保留。', 'Save failed. Your changes are kept.')}
      action={<Button size="small" disabled={editor.locked} onClick={editor.retry}>{text('重试', 'Retry')}</Button>} /></div>}
    {editor.loading && <p className={styles.loading} role="status">{text('正在加载…', 'Loading…')}</p>}
    {editor.draft && <DesktopQualityDefaultsEditor value={editor.draft} disabled={editor.locked} onChange={editor.change} />}
  </SettingsGroup>
}
