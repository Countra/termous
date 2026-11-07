import { Alert, Button, Space } from 'antd'
import type { PresentationState, PresentationSettings } from '@termous/remote-protocol/presentation'

export function DesktopStabilityNotice({ state, onChange, onDismiss, disabled, zh }: {
  state?: PresentationState; onChange(settings: PresentationSettings, retryTarget?: boolean): void; onDismiss(): void; disabled: boolean; zh: boolean
}) {
  const stable = state?.stability
  if (!stable || stable.phase !== 'attention' && !stable.pressure) return null
  const adaptive = state?.capabilities.videoQualityVersion === 1
  const text = (cn: string, en: string) => zh ? cn : en
  const reasons: Record<string, string> = {
    capture_processing: text('采集或色彩转换未能维持目标帧率。', 'Capture or color processing cannot sustain the target frame rate.'),
    encoding: text('编码耗时超过当前帧预算。', 'Encoding exceeds the current frame budget.'),
    decoding: text('接收端解码未能维持目标帧率。', 'The receiver cannot sustain the target decoding rate.'),
    network: text('检测到持续传输丢包或抖动。', 'Sustained packet loss or jitter was observed during transmission.'),
    local_delivery: text('主机视频交付持续超时，画面可能暂时停顿。', 'Video delivery on the host is repeatedly timing out; the picture may briefly freeze.'),
	compression: text('当前编码预算下持续出现高压缩，画面细节可能明显受损。可保持当前配置，或采用较低档位。', 'Sustained heavy compression may be reducing picture detail. Keep the current configuration or choose a lower target.'),
  }
  return <Alert type={adaptive && stable.phase !== 'attention' ? 'info' : 'warning'} showIcon title={adaptive ? text('自动保护画质', 'Automatic quality protection') : text('画质需要确认', 'Quality needs your attention')}
    description={<><p>{stable.phase === 'attention' ? text('目标配置未确认，已请求恢复此前画面。请选择重试或调整画质。', 'The target was not confirmed. Restoration was requested; retry or choose another quality.') : adaptive && stable.pressure === 'quality_recovery' ? text('正在逐步恢复用户目标画质。', 'Restoring the requested quality in steps.') : adaptive && stable.pressure === 'compression' ? text('持续压缩压力触发了清晰度保护，条件改善后将自动恢复。', 'Clarity protection responded to sustained compression. Quality will recover automatically as conditions improve.') : reasons[stable.pressure ?? ''] ?? text('当前画质需要确认。', 'The current quality needs your attention.')}</p>
      <Space wrap>
        <Button disabled={disabled} onClick={onDismiss}>{adaptive ? text('知道了', 'Dismiss') : text('保持当前配置', 'Keep current configuration')}</Button>
        {!adaptive && stable.suggested && <Button disabled={disabled} onClick={() => onChange(stable.suggested!)}>{text('采用建议配置', 'Apply suggested configuration')}</Button>}
        {state?.requested && <Button disabled={disabled} onClick={() => onChange(state.requested!, true)}>{text('重试目标配置', 'Retry target configuration')}</Button>}
      </Space></>} />
}
