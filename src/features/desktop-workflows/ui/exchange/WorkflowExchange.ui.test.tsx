import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { WorkflowExchangeDialog } from './WorkflowExchangeDialog'
import { WorkflowExportDialog } from './WorkflowExportDialog'
import type { WorkflowSurfaceModel, WorkflowMediaGateway } from '../../model/workspace/types'
import type { Definition } from '#entities/desktop-workflow'

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

it('存在图片时不能选择独立 JSON，目录与 ZIP 仍可导出', async () => {
  const submit = vi.fn()
  const definition: Definition = { schema_version: 2, parameters: [], steps: [{ id: 'image', name: '等待模板', kind: 'image.wait', action: {}, image: { asset_id: 'template', offset: { x: 0, y: 0 } } }] }
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowExportDialog name="已保存流程" revision={3} definition={definition} onClose={() => {}} onExport={submit} /></ConfigProvider>)
  await waitFor(() => expect(screen.getByText('已保存流程')).toBeVisible())
  expect(screen.getByText('v3')).toBeVisible()
  expect(screen.getByRole('radio', { name: /desktopWorkflow.exchange.formats.json.title/ })).toBeDisabled()
  expect(screen.getByText('desktopWorkflow.exchange.jsonUnavailable')).toBeVisible()
  expect(screen.getByRole('radio', { name: /desktopWorkflow.exchange.formats.zip.title/ })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: /desktopWorkflow.exchange.formats.directory.title/ }))
  expect(screen.getByText('workflow.termous-workflow/')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.chooseLocation' }))
  expect(submit).toHaveBeenCalledWith('directory')
})

it('无图工作流可选择 JSON，关闭格式窗口不触发导出', async () => {
  const submit = vi.fn(), close = vi.fn()
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowExportDialog name="无图流程" revision={2} definition={{ schema_version: 2, parameters: [], steps: [] }} onClose={close} onExport={submit} /></ConfigProvider>)
  fireEvent.click(screen.getByRole('radio', { name: /desktopWorkflow.exchange.formats.json.title/ }))
  await waitFor(() => expect(screen.getByText('desktopWorkflow.exchange.formats.json.preview')).toBeVisible())
  expect(screen.queryByText('assets/')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'app.cancel' }))
  expect(close).toHaveBeenCalledOnce()
  expect(submit).not.toHaveBeenCalled()
})

it('提交结果未确认时保留原提交入口，禁用修改与关闭', () => {
  const dispatch = vi.fn()
  const model = { state: { exchange: { available: true, busy: false, uncertain: true, name: '待核查', preview: { id: 'import', state: 'ready',
    manifest: { name: '待核查', description: '', tags: [], assets: [], definition: { schema_version: 2, parameters: [], steps: [] } } } } }, scripts: [], actions: { exchange: dispatch } } as unknown as WorkflowSurfaceModel
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowExchangeDialog model={model} gateway={{} as WorkflowMediaGateway} guard={next => next()} /></ConfigProvider>)
  expect(screen.getByRole('textbox', { name: 'desktopWorkflow.scriptName' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'desktopWorkflow.exchange.close' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.retryCommit' }))
  expect(dispatch).toHaveBeenCalledWith({ kind: 'commit' })
})

it('传输可取消，成功回执保留打开原工作流的入口', async () => {
  const dispatch = vi.fn(), load = vi.fn()
  const model = { state: { exchange: { available: true, busy: true, progress: { phase: 'transferring', transferred_bytes: 32, total_bytes: 128 } } }, scripts: [], actions: { exchange: dispatch, load } } as unknown as WorkflowSurfaceModel
  const renderDialog = () => <ConfigProvider theme={{ token: { motion: false } }}><WorkflowExchangeDialog model={model} gateway={{} as WorkflowMediaGateway} guard={next => next()} /></ConfigProvider>
  const view = render(renderDialog())
  await waitFor(() => expect(screen.getByText('desktopWorkflow.exchange.phases.transferring')).toBeVisible())
  expect(screen.getByText('25%')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.cancel' }))
  expect(dispatch).toHaveBeenCalledWith({ kind: 'cancel' })
  model.state.exchange = { available: true, busy: false, receipt: { import_id: 'import', script: { id: 'saved', name: '已导入流程', revision: 1, description: '', tags: [], created_at: '', updated_at: '' }, created_at: '' } }
  view.rerender(renderDialog())
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.open' }))
  expect(load).toHaveBeenCalledWith('saved')
  expect(dispatch).toHaveBeenCalledWith({ kind: 'close' })
})

it('导出成功窗提供打开目录入口，打开期间保留成功信息并允许关闭', async () => {
  const dispatch = vi.fn()
  const model = { state: { exchange: { available: true, busy: false, exported: '流程.zip', exportedLocation: 'location' } }, scripts: [], actions: { exchange: dispatch } } as unknown as WorkflowSurfaceModel
  const renderDialog = () => <ConfigProvider theme={{ token: { motion: false } }}><WorkflowExchangeDialog model={model} gateway={{} as WorkflowMediaGateway} guard={next => next()} /></ConfigProvider>
  const view = render(renderDialog())
  await waitFor(() => expect(screen.getByText('desktopWorkflow.exchange.exported')).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.openDirectory' }))
  expect(dispatch).toHaveBeenCalledWith({ kind: 'open-directory', location_id: 'location' })
  model.state.exchange!.openingDirectory = true
  view.rerender(renderDialog())
  expect(screen.getByRole('button', { name: /desktopWorkflow.exchange.openDirectory/ })).toBeDisabled()
  expect(screen.getByText('desktopWorkflow.exchange.exported')).toBeVisible()
  expect(screen.queryByText('desktopWorkflow.exchange.phases.validating')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.exchange.close' }))
  expect(dispatch).toHaveBeenCalledWith({ kind: 'close' })
  model.state.exchange!.openingDirectory = false
  model.state.exchange!.directoryError = { code: 'workflow_exchange_directory_open_failed', message: '打开失败' }
  view.rerender(renderDialog())
  expect(screen.getByText('desktopWorkflow.exchange.exported')).toBeVisible()
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('button', { name: 'desktopWorkflow.exchange.openDirectory' })).toBeEnabled()
})
