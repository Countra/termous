import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { resourceImage } from '../contracts/runtimeResourceImages.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { progressData, progressFingerprint } from './runtimeToolEvidence.ts'

const captureName = 'termous.desktops.capture'
const keyboardName = 'termous.desktops.keyboard.shortcut'
const clickName = 'termous.desktops.pointer.click'
const args = { attachment_id: 'current' }
const reply = (name: string, data: unknown, readOnly = true) => ({ content: [], details: {
  kind: 'mcp', originalToolName: name, readOnly, result: { content: [], structuredContent: data },
} })
const capture = (id: number, pixels = 'frame', generation = 1) => ({
  ...reply(captureName, { capture: { screenshot_id: `shot-${id}`, expires_at: id,
    metadata: { connection_generation: generation, execution_generation: 1, frame_sequence: id, captured_at: id,
      region: { x: 0, y: 0, width: 800, height: 600 } }, image_view: { width: 800, height: 600 } } }),
  content: [resourceImage({ resource_id: `resource-${id}`, kind: 'image', mime_type: 'image/png', size_bytes: 10,
    sha256: createHash('sha256').update(pixels).digest('hex'), image: { width: 800, height: 600 } })],
})
const accepted = (id: number) => reply(keyboardName, { operation: { state: 'accepted', client_request_id: `request-${id}`, finished_at: id } }, false)

test('资源图片和旧图片按内容比较，资源身份与截图时效不参与画面指纹', () => {
  const resource = capture(1)
  const legacy = { ...resource, content: [{ type: 'image' as const, data: Buffer.from('frame').toString('base64'), mimeType: 'image/png' }] }
  const fingerprint = progressFingerprint(captureName, progressData(resource), resource)
  assert.equal(progressFingerprint(captureName, progressData(legacy), legacy), fingerprint)
  const newer = capture(2)
  assert.equal(progressFingerprint(captureName, progressData(newer), newer), fingerprint)
  for (const changed of [capture(3, 'changed'), capture(4, 'frame', 2)]) {
    assert.notEqual(progressFingerprint(captureName, progressData(changed), changed), fingerprint)
  }
})

test('真实资源图片变化不会产生误报，相同画面第三次观察提供可用鼠标入口', () => {
  const progress = new RuntimeToolProgress()
  for (let id = 0; id < 5; id++) progress.observe(captureName, args, capture(id, `frame-${id}`), false)
  assert.deepEqual(progress.drain(), [])
  for (let id = 5; id < 8; id++) progress.observe(captureName, args, capture(id, 'unchanged'), false)
  const notices = progress.drain()
  assert.equal(notices.length, 1)
  assert.ok(notices[0]!.next_tools.includes(clickName))
  progress.observe(captureName, args, capture(8, 'changed'), false)
  assert.equal(progress.drain()[0]?.status, 'progressed')
})

test('重复接收按键但未观察到变化时给出纠正入口，不阻止合法连续输入', () => {
  for (const observe of [false, true]) {
    const progress = new RuntimeToolProgress()
    progress.observe(captureName, args, capture(0), false)
    for (let id = 1; id <= 3; id++) {
      progress.observe(keyboardName, { ...args, codes: ['KeyY'], client_request_id: String(id) }, accepted(id), false)
      if (observe) progress.observe(captureName, args, capture(id), false)
      assert.equal(progress.beforeCall(keyboardName, args), undefined)
      assert.equal(progress.hidden(keyboardName), false)
    }
    const notices = progress.drain()
    const notice = notices.find((item) => item.tool_name === keyboardName)!
    assert.match(notice.guidance, /尚无画面变化证据/)
    assert.ok(notice.next_tools.includes(clickName))
    assert.ok(notice.next_tools.includes(captureName))
  }
})

test('有画面变化的合法按键、不同按键与未知输入不会进入重复接收诊断', () => {
  const progress = new RuntimeToolProgress()
  for (let id = 0; id < 10; id++) {
    progress.observe(captureName, args, capture(id, `frame-${id}`), false)
    progress.observe(keyboardName, { ...args, codes: ['ArrowDown'] }, accepted(id), false)
  }
  assert.deepEqual(progress.drain(), [])
  const varied = new RuntimeToolProgress()
  for (const code of ['KeyA', 'KeyB', 'KeyC', 'Enter']) varied.observe(keyboardName, { ...args, codes: [code] }, accepted(1), false)
  assert.deepEqual(varied.drain(), [])
  for (const state of ['failed', 'uncertain', 'dispatching']) {
    const unknown = new RuntimeToolProgress()
    for (let id = 0; id < 3; id++) unknown.observe(keyboardName, { ...args, codes: ['KeyY'] },
      reply(keyboardName, { operation: { state } }, false), false)
    assert.ok(unknown.drain().every((notice) => !notice.guidance.includes('尚无画面变化证据')))
  }
})

test('未授权鼠标不出现在恢复候选，诊断不保存按键或图片正文', () => {
  const progress = new RuntimeToolProgress(Date.now, (name) => name !== clickName)
  for (let id = 0; id < 3; id++) progress.observe(keyboardName, { ...args, codes: ['KeyY'] }, accepted(id), false)
  const notice = progress.drain()[0]!
  assert.ok(!notice.next_tools.includes(clickName))
  assert.doesNotMatch(JSON.stringify(progress.snapshot()), /KeyY|resource_image|frame_sequence/)
})
