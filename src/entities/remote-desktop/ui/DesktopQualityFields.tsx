import { SelectControl } from '#shared/ui'
import { useTranslation } from 'react-i18next'
import { presentationPreset, presentationPresetName, type PresentationCapabilities, type PresentationSettings, type PresentationPreset } from '@termous/remote-protocol/presentation'
import { DesktopQualityField } from './DesktopQualityLayout'
import { DesktopQualityNumberInput } from './DesktopQualityNumberInput'
import styles from './DesktopPresentationControls.module.scss'

// 组件只依据呈现能力展示参数，协议与传输选择由适配器负责。
export function DesktopQualityFields({ settings, capabilities, disabled = false, showPreset = true, commitOnBlur = false, onChange }: {
  settings: PresentationSettings
  capabilities: PresentationCapabilities
  disabled?: boolean
  showPreset?: boolean
  commitOnBlur?: boolean
  onChange(value: PresentationSettings): void
}) {
  const { i18n } = useTranslation()
  const text = (cn: string, en: string) => i18n?.language?.startsWith('zh') ? cn : en
  const editable = !disabled && capabilities.available
  const parameters = <>
    {settings.kind === 'pixels' && <DesktopQualityField label={text('更新频率上限', 'Update rate limit')} description={text('越高越流畅，调低更省资源；不改变画面清晰度。', 'Higher is smoother; lower uses fewer resources. Image quality stays the same.')}>
      {attributes => <DesktopQualityNumberInput {...attributes} commitOnBlur={commitOnBlur} disabled={!editable} min={1} max={capabilities.maxUpdateRate ?? 30} precision={0} unit={text('次／秒', 'updates/s')} value={settings.updateRateLimit} onChange={value => { if (value !== null) onChange({ ...settings, updateRateLimit: value }) }} />}
    </DesktopQualityField>}
    {settings.kind === 'video' && <>
      <DesktopQualityField label={text('接收分辨率', 'Receive resolution')} description={!capabilities.dynamicSize ? text('当前连接不支持切换分辨率。', 'This connection does not support resolution changes.') : text('只影响接收画面，不改变远端布局。', 'Changes the received picture, not the remote layout.')}>
        {attributes => <SelectControl {...attributes} disabled={!editable || !capabilities.dynamicSize} value={settings.size} options={[{ value: 'auto', label: text('自动（推荐）', 'Auto (recommended)') }, { value: '720p', label: text('最高 720p', 'Up to 720p') }, { value: '1080p', label: text('最高 1080p', 'Up to 1080p'), disabled: (capabilities.maxHeight ?? 0) < 1080 }]} onChange={size => onChange({ ...settings, size })} />}
      </DesktopQualityField>
      <DesktopQualityField label={text('码率上限', 'Bitrate limit')} description={text('调高可保留更多细节，也更占带宽。', 'A higher limit preserves more detail and uses more bandwidth.')}>
        {attributes => <DesktopQualityNumberInput {...attributes} commitOnBlur={commitOnBlur} disabled={!editable} min={(capabilities.minBitrate ?? 100_000) / 1_000_000} max={(capabilities.maxBitrate ?? 8_000_000) / 1_000_000} step={0.1} precision={1} unit="Mbps" value={settings.bitrate / 1_000_000} onChange={value => { if (value !== null) onChange({ ...settings, bitrate: Math.round(value * 1_000_000) }) }} />}
      </DesktopQualityField>
      <DesktopQualityField label={text('帧率上限', 'Frame rate limit')} description={text('越高越流畅，调低更省资源。', 'Higher is smoother; lower uses fewer resources.')}>
        {attributes => <DesktopQualityNumberInput {...attributes} commitOnBlur={commitOnBlur} disabled={!editable} min={1} max={capabilities.maxFramerate ?? 30} precision={0} unit={text('帧／秒', 'fps')} value={settings.framerate} onChange={value => { if (value !== null) onChange({ ...settings, framerate: value }) }} />}
      </DesktopQualityField>
    </>}
    {settings.kind === 'rfb' && <>
      <DesktopQualityField label={text('画面质量', 'Image quality')} description={text('0～9，越高越清晰，以远端支持为准。', '0–9; higher is clearer, subject to remote support.')}>
        {attributes => <DesktopQualityNumberInput {...attributes} commitOnBlur={commitOnBlur} disabled={!editable} min={0} max={9} precision={0} value={settings.quality} onChange={value => { if (value !== null) onChange({ ...settings, quality: value }) }} />}
      </DesktopQualityField>
      <DesktopQualityField label={text('压缩等级', 'Compression level')} description={text('0～9，越高越省带宽，但更占计算资源。', '0–9; higher saves bandwidth but uses more processing.')}>
        {attributes => <DesktopQualityNumberInput {...attributes} commitOnBlur={commitOnBlur} disabled={!editable} min={0} max={9} precision={0} value={settings.compression} onChange={value => { if (value !== null) onChange({ ...settings, compression: value }) }} />}
      </DesktopQualityField>
    </>}
  </>
  return <>
    {showPreset && <DesktopQualityField label={settings.kind === 'pixels' ? text('流畅度', 'Smoothness') : text('画质方案', 'Quality preset')} description={settings.kind === 'pixels' ? text('仅调整画面更新频率。', 'Adjusts how often the picture updates.') : undefined}>
      {attributes => <SelectControl {...attributes} disabled={!editable} value={presentationPresetName(settings)} options={[
      { value: 'clear', label: settings.kind === 'pixels' ? text('流畅优先', 'Smooth') : text('清晰优先', 'Clear') }, { value: 'balanced', label: text('均衡', 'Balanced') }, { value: 'economy', label: text('省资源', 'Resource saving') }, { value: 'custom', label: text('自定义', 'Custom'), disabled: true },
    ]} onChange={value => {
      const next = presentationPreset(settings.kind, value as PresentationPreset)
      if (next.kind === 'video') { next.bitrate = Math.min(next.bitrate, capabilities.maxBitrate ?? next.bitrate); if ((capabilities.maxHeight ?? 1080) < 1080 && next.size === '1080p') next.size = 'auto' }
      onChange(next)
    }} />}
    </DesktopQualityField>}
    <div className={styles.parameters} data-kind={settings.kind}>{parameters}</div>
  </>
}
