import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkflowDetachedCommand, isWorkflowDetachedMedia, isWorkflowDetachedNoArgumentAction, workflowDetachedActions } from './workflow-detached.ts'

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
