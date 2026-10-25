import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowController } from './WorkflowController'
import { WorkflowSurfaceAdapter } from '../window/WorkflowSurfaceAdapter'
import { readWorkflowLayoutPreferences, workflowLayoutStorageKey } from './workflowLayoutPreferences'

const controllers: WorkflowController[] = []
const create = () => {
  const controller = new WorkflowController({} as WorkflowGateway)
  controllers.push(controller)
  return controller
}
beforeEach(() => window.localStorage.removeItem(workflowLayoutStorageKey))
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.restoreAllMocks()
  window.localStorage.removeItem(workflowLayoutStorageKey)
})

it('重新打开恢复折叠状态和展开宽度，不恢复业务状态，也不标记草稿变更', () => {
  const controller = create()
  const layout = { catalogCollapsed: true, chainCollapsed: true, propertiesVisible: false, editorPanels: { chainWidth: 330, detailsWidth: 380 } }
  controller.actions.presentation({ ...layout, queries: { scripts: '查询正文', runs: '' }, foldedSteps: ['private-step'] })
  expect(controller.getSnapshot().state.dirty).toBe(false)
  expect(JSON.parse(window.localStorage.getItem(workflowLayoutStorageKey)!)).toEqual(layout)
  controller.dispose()
  const reopened = create()
  expect(reopened.getSnapshot().state.presentation).toEqual({ ...layout, queries: { scripts: '', runs: '' }, runFilter: 'all' })
  reopened.actions.presentation({ chainCollapsed: false, propertiesVisible: true })
  expect(create().getSnapshot().state.presentation).toMatchObject({ ...layout, chainCollapsed: false, propertiesVisible: true })
})

it('独立窗口通过宿主命令持久化布局，下次创建工作台时恢复', async () => {
  const host = new WorkflowSurfaceAdapter(create())
  const layout = { chainCollapsed: true, propertiesVisible: false, editorPanels: { chainWidth: 350, detailsWidth: 400 } }
  const response = await host.handle({ connection: { module: 'desktop-workflow', instance: 'workspace', generation: 'test' },
    kind: 'request', operation: 'command', payload: { name: 'presentation', args: [layout], inputSequence: 1 } })
  expect(response.ok).toBe(true)
  expect(create().getSnapshot().state.presentation).toMatchObject(layout)
})

it('无缓存保留响应式默认；损坏或非法字段回退，不接受越界宽度和业务字段', () => {
  expect(readWorkflowLayoutPreferences()).toEqual({})
  window.localStorage.setItem(workflowLayoutStorageKey, '{broken')
  expect(create().getSnapshot().state.presentation).toEqual({ propertiesVisible: true, queries: { scripts: '', runs: '' }, runFilter: 'all' })
  window.localStorage.setItem(workflowLayoutStorageKey, JSON.stringify({ catalogCollapsed: false, chainCollapsed: 'true', propertiesVisible: null,
    editorPanels: { chainWidth: 999999, detailsWidth: 300 }, queries: { scripts: '不要恢复' } }))
  expect(readWorkflowLayoutPreferences()).toEqual({ catalogCollapsed: false })
})

it('普通展示更新和相同尺寸不反复写入缓存', () => {
  const controller = create()
  const write = vi.spyOn(Storage.prototype, 'setItem')
  controller.actions.presentation({ queries: { scripts: 'query', runs: '' }, foldedSteps: ['step'] })
  expect(write).not.toHaveBeenCalled()
  controller.actions.presentation({ editorPanels: { chainWidth: 300, detailsWidth: 340 } })
  controller.actions.presentation({ editorPanels: { chainWidth: 300, detailsWidth: 340 } })
  expect(write).toHaveBeenCalledTimes(1)
})

it('存储读取或写入失败不阻止当前布局调整，恢复后可再次保存', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied') })
  const controller = create()
  read.mockRestore()
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
  expect(() => controller.actions.presentation({ chainCollapsed: true })).not.toThrow()
  expect(controller.getSnapshot().state.presentation.chainCollapsed).toBe(true)
  write.mockRestore()
  controller.actions.presentation({ propertiesVisible: false })
  expect(readWorkflowLayoutPreferences()).toMatchObject({ chainCollapsed: true, propertiesVisible: false })
})
