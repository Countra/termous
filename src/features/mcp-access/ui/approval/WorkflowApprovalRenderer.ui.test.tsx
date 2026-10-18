import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowApprovalRenderer } from './WorkflowApprovalRenderer'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('桌面脚本审批摘要', () => {
  it('运行展示固定版本、实际目标及连接策略，删除只展示脚本', () => {
    const view = render(<WorkflowApprovalRenderer operation={{ remote_paths: [], local_paths: [], rename_mappings: [], action: 'run', script_id: 'script', script_version: 3,
      target_resource_name: '回归脚本', resource_name: '测试桌面', resource_kind: 'vnc', resource_id: 'connection',
      mode: 'takeover', item_count: 4, lifecycle: 'close_owned', timeout_seconds: 1800 }} />)
    expect(screen.getByText('v3')).toBeVisible()
    expect(screen.getByText('回归脚本')).toBeVisible()
    expect(screen.getByText('测试桌面')).toBeVisible()
    expect(screen.getByText('VNC')).toBeVisible()
    expect(screen.getByText('desktopWorkflow.approval.takeover')).toBeVisible()
    expect(screen.getByText('desktopWorkflow.approval.close_owned')).toBeVisible()
    view.rerender(<WorkflowApprovalRenderer operation={{ remote_paths: [], local_paths: [], rename_mappings: [], action: 'delete', script_id: 'script', script_version: 3, resource_name: '回归脚本' }} />)
    expect(screen.getByText('desktopWorkflow.deleteHint')).toBeVisible()
    expect(screen.queryByText('测试桌面')).not.toBeInTheDocument()
  })
})
