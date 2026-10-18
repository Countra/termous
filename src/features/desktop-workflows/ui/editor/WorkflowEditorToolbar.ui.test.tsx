import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { WorkflowEditorToolbar } from './WorkflowEditorToolbar'
import { PreviewModeControl } from './PreviewModeControl'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('明确的流程设置入口可管理草稿，进入参数配置时收起设置面板', async () => {
  const props = { name: '流程', description: '', tags: [], revision: 2, parameterCount: 1, dirty: true, busy: false, propertiesVisible: true,
    onChange: vi.fn(), onSave: vi.fn(), onValidate: vi.fn(), onRun: vi.fn(), onProperties: vi.fn(), onParameters: vi.fn(), onHistory: vi.fn(), onCopy: vi.fn(), onRemove: vi.fn() }
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowEditorToolbar {...props} /></ConfigProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.workflowSettings' }))
  const drawer = await screen.findByRole('dialog')
  fireEvent.change(within(drawer).getByRole('textbox', { name: 'desktopWorkflow.description' }), { target: { value: '编辑中的说明' } })
  expect(props.onChange).toHaveBeenCalledWith({ description: '编辑中的说明' })
  expect(props.onSave).not.toHaveBeenCalled()
  fireEvent.click(within(drawer).getByRole('button', { name: /desktopWorkflow.parameters/ }))
  expect(props.onParameters).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'desktopWorkflow.workflowSettings' })).toHaveAttribute('aria-expanded', 'false')
})

it('预览模式保留明确选中状态，并限制不支持选点的步骤', () => {
  const change = vi.fn()
  const view = render(<PreviewModeControl value="template" disabled={false} pointDisabled onChange={change} />)
  expect(screen.getByRole('button', { name: 'desktopWorkflow.select_point' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'desktopWorkflow.select_template' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.select_region' }))
  expect(change).toHaveBeenCalledWith('region')
  view.rerender(<PreviewModeControl value="region" disabled pointDisabled={false} onChange={change} />)
  expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)
})
