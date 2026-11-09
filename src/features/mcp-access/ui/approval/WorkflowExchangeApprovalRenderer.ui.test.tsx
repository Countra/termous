import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WorkflowApprovalRenderer } from './WorkflowApprovalRenderer'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('文件交换审批显示 Core 路径、固定版本和覆盖行为', () => {
  const view = render(<WorkflowApprovalRenderer operation={{ action: 'import', local_paths: ['D:/中文/workflow.json'], remote_paths: [], rename_mappings: [] }} />)
  expect(screen.getByText('D:/中文/workflow.json')).toBeVisible()
  expect(screen.getByText('desktopWorkflow.approval.exchange.readHint')).toBeVisible()
  expect(screen.queryByText('desktopWorkflow.deleteHint')).not.toBeInTheDocument()
  view.rerender(<WorkflowApprovalRenderer operation={{ action: 'export', local_target: 'D:/output.zip', script_id: 'script', script_version: 3, mode: 'zip', overwrite_policy: 'overwrite', local_paths: [], remote_paths: [], rename_mappings: [] }} />)
  expect(screen.getByText('v3')).toBeVisible()
  expect(screen.getByText('D:/output.zip')).toBeVisible()
  expect(screen.getByText('desktopWorkflow.approval.exchange.replace')).toBeVisible()
  view.rerender(<WorkflowApprovalRenderer operation={{ action: 'import', local_paths: [], remote_paths: [], rename_mappings: [] }} />)
  expect(screen.queryByText('D:/中文/workflow.json')).not.toBeInTheDocument()
  expect(screen.getByText('—')).toBeVisible()
})
