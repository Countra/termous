import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowOrigin } from './WorkflowOrigin'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { name?: string }) => `${key}${args?.name ? ` · ${args.name}` : ''}` }) }))

describe('脚本创建来源', () => {
  it('仅 MCP 来源显示机器人，并区分内置助手与外部客户端', () => {
    const view = render(<WorkflowOrigin author={{ origin: 'app' }} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    view.rerender(<WorkflowOrigin author={{ origin: 'mcp', client_source: 'builtin_agent', client_name: '助手' }} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('desktopWorkflow.origin.createdBy · desktopWorkflow.origin.agent')
    view.rerender(<WorkflowOrigin author={{ origin: 'mcp', client_source: 'external', client_name: '测试客户端' }} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('desktopWorkflow.origin.createdBy · desktopWorkflow.origin.mcp · 测试客户端')
  })
})
