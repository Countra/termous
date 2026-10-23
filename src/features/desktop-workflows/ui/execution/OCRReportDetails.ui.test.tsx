import { act,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import type { OCRReportPage,StepResult } from '#entities/desktop-workflow'
import { OCRReportDetails } from './OCRReportDetails'

vi.mock('react-i18next',() => ({useTranslation:() => ({t:(key:string) => key})}))
const summary = {samples:2,observations:[],available:true,report_truncated:false}
const step:StepResult={run_id:'run',index:1,step_id:'read',occurrence:'/read',kind:'ocr.read',state:'accepted',started_at:'',ocr:summary}
const page:OCRReportPage={summary,items:[{role:'condition',id:0,text:'保存\nSave',confidence:.9,bbox_xyxy:[1,1,10,10],center_xy:[5,5],matched:true}],total:1,offset:0,limit:20}

it('明细只在显式展开后读取，切换步骤取消旧请求',async () => {
  let finish!:(v:OCRReportPage) => void
  const gateway={ocrReport:vi.fn().mockImplementation(() => new Promise<OCRReportPage>(resolve => {finish=resolve}))}
  const view=render(<OCRReportDetails step={step} gateway={gateway} />)
  expect(gateway.ocrReport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'desktopWorkflow.ocr.details'}))
  await waitFor(() => expect(gateway.ocrReport).toHaveBeenCalledOnce())
  const signal=gateway.ocrReport.mock.calls[0]![4] as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => finish(page))
  expect(screen.queryByText(/Save/)).not.toBeInTheDocument()
})

it('敏感查询不提供明细入口，正常报告按需显示原文和边界',async () => {
  const gateway={ocrReport:vi.fn().mockResolvedValue(page)}
  const view=render(<OCRReportDetails step={{...step,ocr:{...summary,available:false,redacted:true}}} gateway={gateway} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(gateway.ocrReport).not.toHaveBeenCalled()
  view.rerender(<OCRReportDetails step={step} gateway={gateway} />)
  fireEvent.click(screen.getByRole('button',{name:'desktopWorkflow.ocr.details'}))
  expect(await screen.findByText('保存 Save')).toBeInTheDocument()
  expect(screen.getByText('1, 1, 10, 10')).toBeInTheDocument()
})

it('轮询相同摘要不重复加载，最终检查点更新后读取最新正文', async () => {
  const latest = { ...page, items: [{ ...page.items[0]!, text: '重新定位后的文字' }] }
  const gateway = { ocrReport: vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce(latest) }
  const view = render(<OCRReportDetails step={{ ...step, state: 'dispatching' }} gateway={gateway} />)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.details' }))
  expect(await screen.findByText('保存 Save')).toBeInTheDocument()
  view.rerender(<OCRReportDetails step={{ ...step, state: 'dispatching', ocr: { ...summary } }} gateway={gateway} />)
  expect(gateway.ocrReport).toHaveBeenCalledOnce()
  view.rerender(<OCRReportDetails step={{ ...step, finished_at: '2026-10-23T00:00:00Z' }} gateway={gateway} />)
  expect(await screen.findByText('重新定位后的文字')).toBeInTheDocument()
  expect(screen.queryByText('保存 Save')).not.toBeInTheDocument()
  expect(gateway.ocrReport).toHaveBeenCalledTimes(2)
})

it('证据回收立即移除旧正文，未完成的读取不能将其恢复', async () => {
  let finish!: (v: OCRReportPage) => void
  const gateway = { ocrReport: vi.fn().mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise<OCRReportPage>(resolve => { finish = resolve })) }
  const view = render(<OCRReportDetails step={step} gateway={gateway} />)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.details' }))
  expect(await screen.findByText('保存 Save')).toBeInTheDocument()
  view.rerender(<OCRReportDetails step={{ ...step, ocr: { ...summary, samples: 3 } }} gateway={gateway} />)
  await waitFor(() => expect(gateway.ocrReport).toHaveBeenCalledTimes(2))
  const signal = gateway.ocrReport.mock.calls[1]![4] as AbortSignal
  view.rerender(<OCRReportDetails step={{ ...step, ocr: { ...summary, available: false, cleared: true } }} gateway={gateway} />)
  expect(signal.aborted).toBe(true)
  await act(async () => finish(page))
  expect(screen.queryByText('保存 Save')).not.toBeInTheDocument()
  expect(screen.getByText('desktopWorkflow.evidenceCleared')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'desktopWorkflow.ocr.details' })).not.toBeInTheDocument()
})
