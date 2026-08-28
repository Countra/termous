import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openUrl = vi.fn(async () => ({ ok: true }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#shared/bridge', () => ({
  getTermousBridge: () => ({ external: { openUrl } }),
}))

import { AgentMarkdown } from './AgentMarkdown.tsx'

describe('AgentMarkdown', () => {
  beforeEach(() => openUrl.mockClear())

  it('拒绝 raw HTML、远程图片与非 HTTP 外链', () => {
    const view = render(
      <AgentMarkdown>{'<script>alert(1)</script>\n\n![secret](https://remote.test/a.png)\n\n[unsafe](javascript:alert(1))'}</AgentMarkdown>,
    )
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByText('agent.markdown.remoteImageBlocked')).toBeInTheDocument()
    const unsafe = screen.getByText('unsafe')
    expect(unsafe.closest('a')).toBeNull()
    fireEvent.click(unsafe)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('HTTP 外链只通过安全 Bridge 打开', () => {
    render(<AgentMarkdown>{'[docs](https://example.com/guide)'}</AgentMarkdown>)
    fireEvent.click(screen.getByRole('link', { name: /docs/ }))
    expect(openUrl).toHaveBeenCalledWith('https://example.com/guide')
  })
})
