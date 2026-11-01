import { Alert, Button, Space } from 'antd'
import type { PresentationState, PresentationSettings } from '@termous/remote-protocol/presentation'

export function DesktopStabilityNotice({ state, onChange, onDismiss, disabled, zh }: {
  state?: PresentationState; onChange(settings: PresentationSettings): void; onDismiss(): void; disabled: boolean; zh: boolean
}) {
  const stable = state?.stability
  if (!stable || stable.phase !== 'attention' && !stable.pressure) return null
  const text = (cn: string, en: string) => zh ? cn : en
  const reasons: Record<string, string> = {
    capture_processing: text('采集或色彩转换未能维持目标帧率。', 'Capture or color processing cannot sustain the target frame rate.'),
    encoding: text('编码耗时超过当前帧预算。', 'Encoding exceeds the current frame budget.'),
    decoding: text('接收端解码未能维持目标帧率。', 'The receiver cannot sustain the target decoding rate.'),
    network: text('当前网络持续拥塞。', 'The current network is persistently congested.'),
	compression: text('当前编码预算下持续出现高压缩，画面细节可能明显受损。可保持当前配置，或采用较低档位。', 'Sustained heavy compression may be reducing picture detail. Keep the current configuration or choose a lower target.'),
  }
  return <Alert type="warning" showIcon title={text('画质需要确认', 'Quality needs your attention')}
    description={<><p>{stable.phase === 'attention' ? text('目标配置未确认，已请求恢复此前画面。请选择重试或调整画质。', 'The target was not confirmed. Restoration was requested; retry or choose another quality.') : reasons[stable.pressure ?? '']}</p>
      <Space wrap>
        <Button disabled={disabled} onClick={onDismiss}>{text('保持当前配置', 'Keep current configuration')}</Button>
        {stable.suggested && <Button disabled={disabled} onClick={() => onChange(stable.suggested!)}>{text('采用建议配置', 'Apply suggested configuration')}</Button>}
        {state?.requested && <Button disabled={disabled} onClick={() => onChange(state.requested!)}>{text('重试目标配置', 'Retry target configuration')}</Button>}
      </Space></>} />
}
