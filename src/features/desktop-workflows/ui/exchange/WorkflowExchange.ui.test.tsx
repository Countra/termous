import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { WorkflowExchangeDialog } from './WorkflowExchangeDialog'
import { WorkflowExportDialog } from './WorkflowExportDialog'
import type { WorkflowSurfaceModel, WorkflowMediaGateway } from '../../model/workspace/types'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('导入预览显示草稿诊断，确认提交仍经过未保存保护', async () => {
  const dispatch = vi.fn(), guard = vi.fn()
  const model = { state: { exchange: { available: true, busy: false, name: '草稿', preview: { id: 'import', state: 'ready',
    manifest: { name: '草稿', description: '测试说明', tags: [], assets: [], definition: { schema_version: 2, parameters: [], steps: [] } },
    diagnostics: [{ field: 'steps', code: 'steps_required' }] } } }, scripts: [], actions: { exchange: dispatch } } as unknown as WorkflowSurfaceModel
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowExchangeDialog model={model} gateway={{} as WorkflowMediaGateway} guard={guard} /></ConfigProvider>)
  await waitFor(() => expect(screen.getByText('desktopWorkflow.exchange.incomplete')).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.create' }))
  expect(guard).toHaveBeenCalledOnce(); expect(dispatch).not.toHaveBeenCalled()
  guard.mock.calls[0][0](); expect(dispatch).toHaveBeenCalledWith({ kind: 'commit' })
})

it('存在图片时不能选择独立 JSON，目录与 ZIP 仍可导出', () => {
  const submit = vi.fn()
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowExportDialog hasAssets onClose={() => {}} onExport={submit} /></ConfigProvider>)
  expect(screen.getByRole('radio', { name: 'desktopWorkflow.exchange.json' })).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: 'desktopWorkflow.exchange.directory' }))
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.export' }))
  expect(submit).toHaveBeenCalledWith('directory')
})
