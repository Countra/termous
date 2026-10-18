import { waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Definition, Run, Version, WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowExecution } from './WorkflowExecution'

const run: Run = { id: 'run', script_id: 'script', version: 2, name: '运行', state: 'paused', phase: 'paused', executed: 1, assertions: 0, revision: 1, started_at: '2026-10-17T00:00:00Z' }
const definition = (text: string): Definition => ({ schema_version: 1, parameters: [], steps: [{ id: 'input', name: '', kind: 'keyboard.text', action: { text } }] })
const version = (number: number, text: string): Version => ({ script_id: 'script', number, definition: definition(text), created_at: '' })
function fixture() {
  const gateway = { run: vi.fn().mockResolvedValue({ run, steps: [] }), versions: vi.fn(), control: vi.fn().mockResolvedValue(run) } as unknown as WorkflowGateway
  return { gateway, execution: new WorkflowExecution(gateway, vi.fn()) }
}

it('历史动作只读取执行的固定版本，事件刷新不重复加载版本', async () => {
  const { gateway, execution } = fixture()
  vi.mocked(gateway.versions).mockResolvedValue([version(3, '最新内容'), version(2, '执行时内容')])
  execution.selectReport(run.id, true)
  await waitFor(() => expect(execution.getSnapshot().report.definition?.status).toBe('ready'))
  expect(execution.getSnapshot().report.definition?.value).toEqual(definition('执行时内容'))
  await execution.refreshReport()
  expect(gateway.versions).toHaveBeenCalledTimes(1)
  execution.dispose()
})

it('切换执行记录后忽略迟到版本，缺失固定版本不使用最新内容', async () => {
  const { gateway, execution } = fixture()
  let resolve!: (versions: Version[]) => void
  vi.mocked(gateway.versions).mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue([version(3, '最新内容')])
  execution.selectReport(run.id, true)
  await waitFor(() => expect(gateway.versions).toHaveBeenCalledTimes(1))
  vi.mocked(gateway.run).mockResolvedValue({ run: { ...run, id: 'other', version: 1 }, steps: [] })
  execution.selectReport('other', true)
  await waitFor(() => expect(execution.getSnapshot().report.definition).toMatchObject({ runID: 'other', status: 'unavailable' }))
  resolve([version(2, '旧请求的内容')])
  await Promise.resolve()
  expect(execution.getSnapshot().report.definition).toEqual({ runID: 'other', status: 'unavailable', value: undefined })
  execution.dispose()
})

it('动作配置失败不阻断运行控制，仅显式刷新重试版本读取', async () => {
  const { gateway, execution } = fixture()
  vi.mocked(gateway.versions).mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue([version(2, '恢复内容')])
  execution.selectReport(run.id, true)
  await waitFor(() => expect(execution.getSnapshot().report.definition?.status).toBe('failed'))
  expect(execution.getSnapshot().report.value?.run.id).toBe(run.id)
  await execution.control('step')
  expect(gateway.control).toHaveBeenCalled()
  expect(gateway.versions).toHaveBeenCalledTimes(1)
  await execution.refreshReport(true)
  await waitFor(() => expect(execution.getSnapshot().report.definition?.status).toBe('ready'))
  expect(gateway.versions).toHaveBeenCalledTimes(2)
  execution.dispose()
})

it('释放宿主后迟到版本不再更新报告', async () => {
  const { gateway, execution } = fixture()
  let resolve!: (versions: Version[]) => void
  vi.mocked(gateway.versions).mockImplementation(() => new Promise(done => { resolve = done }))
  execution.selectReport(run.id, true)
  await waitFor(() => expect(gateway.versions).toHaveBeenCalledOnce())
  execution.dispose()
  const previous = execution.getSnapshot()
  resolve([version(2, '迟到内容')])
  await Promise.resolve()
  expect(execution.getSnapshot()).toBe(previous)
})
