import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkflowDetachedCommand, isWorkflowDetachedMedia, isWorkflowDetachedNoArgumentAction, workflowDetachedActions } from './workflow-detached.ts'

test('分栏偏好仅接受有界尺寸与明确折叠状态，旧展示状态仍兼容', () => {
  const valid = (value: unknown) => isWorkflowDetachedCommand({ name: 'presentation', inputSequence: 1, args: [value] })
  assert(valid({ propertiesVisible: true }))
  assert(valid({ chainCollapsed: false, editorPanels: { chainWidth: 220, detailsWidth: 480 } }))
  assert(valid({ editorPanels: { chainWidth: 420, detailsWidth: 260 } }))
  for (const editorPanels of [null, {}, { chainWidth: 0, detailsWidth: 300 }, { chainWidth: 268, detailsWidth: Infinity }, { chainWidth: 421, detailsWidth: 300 }, { chainWidth: 268, detailsWidth: 300, extra: true }]) assert(!valid({ editorPanels }))
  assert(!valid({ chainCollapsed: 'yes' }))
})

test('分析跨窗口状态只传轻量筛选与视图，取消读取不复用任务取消', () => {
  const state = { open: true, id: 'record', layer: 'ocr', filter: { text_gt: .5 }, selected: 2, history: false, view: { zoom: 1, boxes: true } }
  const valid = (analysis: unknown) => isWorkflowDetachedCommand({ name: 'presentation', inputSequence: 1, args: [{ analysis }] })
  assert(valid(state))
  for (const labelMode of ['auto', 'all', 'none']) assert(valid({ ...state, view: { ...state.view, labelMode } }))
  for (const labelMode of [null, ['auto'], 'unknown', 1]) assert(!valid({ ...state, view: { ...state.view, labelMode } }))
  assert(valid({ ...state, resultsVisible: false, panels: { historyWidth: 220, resultsWidth: 520 } }))
  for (const panels of [null, {}, { historyWidth: 219, resultsWidth: 348 }, { historyWidth: 252, resultsWidth: Infinity }, { historyWidth: 252, resultsWidth: 521 }, { historyWidth: 252, resultsWidth: 348, blob: 'image' }]) assert(!valid({ ...state, panels }))
  assert(!valid({ ...state, resultsVisible: 'false' }))
  for (const extra of [{ blob: new Blob(['image']) }, { filter: { body: 'image' } }, { view: { zoom: Infinity, boxes: true } }, { selected: -1 }]) assert(!valid({ ...state, ...extra }))
  assert(isWorkflowDetachedMedia({ kind: 'analysis-read-cancel', id: 'read' }))
  assert(isWorkflowDetachedMedia({ kind: 'analysis', read_id: 'read', request: { operation: 'image', id: 'record', image: 'original' } }))
})

test('无参数动作只接受空参数，编辑和运行控制仍要求业务参数', () => {
  for (const name of workflowDetachedActions.filter(isWorkflowDetachedNoArgumentAction)) {
    assert(isWorkflowDetachedCommand({ name, args: [] }), name)
    assert(!isWorkflowDetachedCommand({ name, args: [{ type: 'click' }] }), name)
  }
  assert(!isWorkflowDetachedNoArgumentAction('change'))
  assert(!isWorkflowDetachedNoArgumentAction('control'))
})

test('自动化独立窗口拒绝未知命令、非法输入序号和额外草稿字段', () => {
  assert(isWorkflowDetachedCommand({ name: 'change', args: [{ name: '草稿' }], owner: 'draft', inputSequence: 1 }))
  assert(!isWorkflowDetachedCommand({ name: 'fetch', args: ['http://example.invalid'] }))
  assert(!isWorkflowDetachedCommand({ name: 'change', args: [{ script: { id: 'other' } }], inputSequence: 1 }))
  assert(!isWorkflowDetachedCommand({ name: 'change', args: [{}] }))
  assert(!isWorkflowDetachedCommand({ name: 'save', args: [], inputSequence: 1 }))
  assert(isWorkflowDetachedCommand({ name: 'dismissNotice', args: ['notice-id'] }))
  assert(!isWorkflowDetachedCommand({ name: 'dismissNotice', args: [] }))
  assert(!isWorkflowDetachedCommand({ name: 'change', args: [JSON.parse('{"__proto__":{}}')], inputSequence: 1 }))
  assert(!isWorkflowDetachedCommand({ name: 'change', args: [{ description: 'x'.repeat(2 * 1024 * 1024) }], inputSequence: 1 }))
})

test('自动化媒体只接受有界图片与指定的预览操作', () => {
  assert(isWorkflowDetachedMedia({ kind: 'runtime-warmup' }))
  assert(!isWorkflowDetachedMedia({ kind: 'runtime-warmup', endpoint: 'http://example.invalid' }))
  assert(isWorkflowDetachedMedia({ kind: 'upload', bytes: new ArrayBuffer(10), type: 'image/png' }))
  assert(!isWorkflowDetachedMedia({ kind: 'upload', bytes: new ArrayBuffer(8 * 1024 * 1024 + 1), type: 'image/png' }))
  assert(!isWorkflowDetachedMedia({ kind: 'upload', bytes: new ArrayBuffer(1), type: 'text/plain' }))
  assert(!isWorkflowDetachedMedia({ kind: 'open', session: 'desktop', generation: 0 }))
  assert(!isWorkflowDetachedMedia({ kind: 'file', path: 'C:/private' }))
})

test('自动化输入保持展示与运行配置的类型形状，允许尚未完成的草稿', () => {
  const input = (name: string, value: unknown) => isWorkflowDetachedCommand({ name, args: [value], inputSequence: 1 })
  assert(input('change', { name: '', definition: { schema_version: 1, parameters: [], steps: [] } }))
  assert(input('presentation', { foldedSteps: ['condition'], queries: { scripts: '查询', runs: '' } }))
  assert(input('presentation', { reportExpansion: { runID: 'run', allExpanded: true, exceptions: ['run:2'] } }))
  assert(input('changeRun', { parameters: { text: '', count: 0, enabled: false } }))
  for (const value of [{ name: {} }, { tags: 'tag' }, { definition: { steps: null } }]) assert(!input('change', value))
  for (const value of [{ keep: 'yes' }, { takeover: 1 }, { parameters: { text: [] } }]) assert(!input('changeRun', value))
  for (const value of [{ foldedSteps: [1] }, { queries: { scripts: 2, runs: '' } }, { propertiesVisible: 'yes' }]) assert(!input('presentation', value))
  for (const reportExpansion of [{ runID: '', allExpanded: true, exceptions: [] }, { runID: 'run', allExpanded: 'yes', exceptions: [] }, { runID: 'run', allExpanded: true, exceptions: [1] }]) assert(!input('presentation', { reportExpansion }))
})
