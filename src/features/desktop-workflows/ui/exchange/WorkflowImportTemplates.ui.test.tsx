import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkflowExchangeAsset } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { WorkflowImportTemplates } from './WorkflowImportTemplates'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.restoreAllMocks())
const asset: WorkflowExchangeAsset = { path: 'assets/template.png', sha256: 'first', size: 24, width: 20, height: 10 }
function view(id: string, assets: WorkflowExchangeAsset[], gateway: WorkflowMediaGateway) {
  return <ConfigProvider theme={{ token: { motion: false } }}><WorkflowImportTemplates id={id} assets={assets} gateway={gateway} /></ConfigProvider>
}

it('更换图片后忽略旧请求，卸载释放对象地址并取消读取', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let old!: (blob: Blob) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise<Blob>(resolve => { old = resolve })).mockResolvedValue(new Blob(['current']))
  const gateway = { importAsset: read } as unknown as WorkflowMediaGateway
  const rendered = render(view('import', [asset], gateway))
  rendered.rerender(view('import', [{ ...asset, sha256: 'next' }], gateway))
  await waitFor(() => expect(screen.getByAltText(asset.path)).toHaveAttribute('src', 'blob:current'))
  expect(read.mock.calls[0][2].aborted).toBe(true)
  old(new Blob(['old']))
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce())
  rendered.unmount()
  expect(read.mock.calls[1][2].aborted).toBe(true)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:current')
})

it('缺少媒体入口或读取失败显示错误，更换入口后可以正常显示', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovered')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const rendered = render(view('import', [asset], {} as WorkflowMediaGateway))
  await waitFor(() => expect(screen.getByLabelText('desktopWorkflow.exchange.imageFailed')).toBeVisible())
  rendered.rerender(view('import', [asset], { importAsset: vi.fn().mockRejectedValue(new Error('读取失败')) } as unknown as WorkflowMediaGateway))
  await waitFor(() => expect(screen.getByLabelText('desktopWorkflow.exchange.imageFailed')).toBeVisible())
  rendered.rerender(view('import', [asset], { importAsset: vi.fn().mockResolvedValue(new Blob(['recovered'])) } as unknown as WorkflowMediaGateway))
  await waitFor(() => expect(screen.getByAltText(asset.path)).toHaveAttribute('src', 'blob:recovered'))
  expect(screen.queryByLabelText('desktopWorkflow.exchange.imageFailed')).not.toBeInTheDocument()
})

it('模板只按页读取，换页取消前页读取并释放图片', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:template')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const read = vi.fn().mockResolvedValue(new Blob(['image']))
  const assets = Array.from({ length: 13 }, (_, i) => ({ ...asset, path: `assets/${i}.png`, sha256: String(i) }))
  render(view('import', assets, { importAsset: read } as unknown as WorkflowMediaGateway))
  await waitFor(() => expect(screen.getAllByAltText(/assets\//)).toHaveLength(12))
  expect(read).toHaveBeenCalledTimes(12)
  fireEvent.click(screen.getByTitle('2'))
  await waitFor(() => expect(screen.getByAltText('assets/12.png')).toBeVisible())
  expect(read).toHaveBeenCalledTimes(13)
  expect(read.mock.calls.slice(0, 12).every(call => call[2].aborted)).toBe(true)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(12)
})
