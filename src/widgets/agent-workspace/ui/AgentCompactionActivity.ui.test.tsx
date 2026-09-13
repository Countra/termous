import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import type { AgentCompactionActivity as Activity } from '#entities/agent'
import { i18n } from '#shared/i18n'
import { AgentCompactionActivity } from './AgentCompactionActivity.tsx'

const activity: Activity = {
  compaction_id: 'compact-one', status: 'started', reason: 'threshold',
  assistant_message_id: 'assistant-one', after_part_sequence: 0,
  tokens_before: 26_500, created_at: '2026-09-05T00:00:00Z',
}

describe('AgentCompactionActivity', () => {
  it('同一活动从压缩中原位变为完成，通过状态区域播报真实比例和耗时', async () => {
    const started = { ...activity, tokens_before: 80_000, context_window_tokens: 100_000 }
    const { rerender, element } = await renderActivity(started)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('正在整理上下文…')
    expect(status).toHaveTextContent('80%')
    expect(status).not.toHaveTextContent('→')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    rerender(element({ ...started, status: 'completed', tokens_after: 30_000, duration_ms: 2_400 }))
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('已自动整理上下文')
    expect(status).toHaveTextContent('80% → 30%')
    expect(status).toHaveTextContent('2.4 s')
  })

  it.each(['failed', 'cancelled'] as const)('显示 %s 的压前比例和真实耗时，不误报压后值', async (status) => {
    await renderActivity({ ...activity, status, tokens_before: 80_000, tokens_after: 30_000, context_window_tokens: 100_000, duration_ms: 350 })
    expect(screen.getByRole('status')).toHaveTextContent(status === 'failed' ? '整理上下文失败' : '整理上下文已取消')
    expect(screen.getByRole('status')).toHaveTextContent('80%')
    expect(screen.getByRole('status')).toHaveTextContent('350 ms')
    expect(screen.getByRole('status')).not.toHaveTextContent('→')
    expect(screen.getByRole('status')).not.toHaveTextContent('30%')
  })

  it('手动压缩完成使用独立文案', async () => {
    await renderActivity({ ...activity, reason: 'manual', status: 'completed' })
    expect(screen.getByRole('status')).toHaveTextContent('已整理上下文')
  })

  it('百分比最多一位小数，保留超过窗口的真实值和零 token', async () => {
    const source: Activity = { ...activity, status: 'completed', context_window_tokens: 100_000, tokens_before: 100_440, tokens_after: 0 }
    const { rerender, element } = await renderActivity(source)
    expect(screen.getByRole('status')).toHaveTextContent('100.4% → 0%')
    rerender(element({ ...source, tokens_before: 80_440, tokens_after: 30_440 }))
    expect(screen.getByRole('status')).toHaveTextContent('80.4% → 30.4%')
  })

  it('旧活动缺少窗口时显示 token 前后值，不假造耗时', async () => {
    await renderActivity({ ...activity, status: 'completed', tokens_after: 8_000 })
    expect(screen.getByRole('status')).toHaveTextContent('26,500 token → 8,000 token')
    expect(screen.getByRole('status')).not.toHaveTextContent('%')
    expect(screen.getByRole('status')).not.toHaveTextContent('0 ms')
    expect(screen.getByRole('status')).not.toHaveTextContent('0.0 s')
  })

  it('真实零毫秒可显示，压缩中不显示终态耗时或压后值', async () => {
    const { rerender, element } = await renderActivity({ ...activity, status: 'completed', duration_ms: 0 })
    expect(screen.getByRole('status')).toHaveTextContent('0 ms')
    rerender(element({ ...activity, tokens_after: 1_000, duration_ms: 5_000 }))
    expect(screen.getByRole('status')).not.toHaveTextContent('5.0 s')
    expect(screen.getByRole('status')).not.toHaveTextContent('→')
  })

  it('元信息可通过键盘聚焦，说明真实 token、当次窗口及耗时', async () => {
    await renderActivity({ ...activity, status: 'completed', tokens_after: 8_000, context_window_tokens: 32_768, duration_ms: 2_400 })
    const metadata = screen.getByRole('group', { name: '估算占用：整理前 26,500 token，整理后 8,000 token。 当次模型上下文窗口为 32,768 token。 耗时 2.4 s。' })
    await userEvent.setup().tab()
    expect(metadata).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('整理前 26,500 token，整理后 8,000 token。')
  })

  it('英文状态和指标说明使用对应翻译', async () => {
    await renderActivity({ ...activity, status: 'completed', tokens_after: 8_000, context_window_tokens: 32_768, duration_ms: 2_400 }, 'en-US')
    expect(screen.getByRole('status')).toHaveTextContent('Context automatically compacted')
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Estimated context usage before compaction: 26,500 tokens; after compaction: 8,000 tokens. This run\'s model context window: 32,768 tokens. Duration: 2.4 s.')
  })
})

async function renderActivity(value: Activity, language = 'zh-CN') {
  const localized = i18n.cloneInstance({ lng: language })
  await localized.changeLanguage(language)
  const element = (activity: Activity) => <I18nextProvider i18n={localized}><AgentCompactionActivity activity={activity} /></I18nextProvider>
  return { ...render(element(value)), element }
}
