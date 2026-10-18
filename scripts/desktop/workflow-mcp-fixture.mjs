import assert from 'node:assert/strict'

// 只用于合成 RFB 桌面，不得将该固定坐标和测试输入用于真实目标。
export async function verifyWorkflowMCP(client, attachment, session) {
  let serial = 0
  const call = async (name, args = {}, mutation = false) => {
    const result = await client.callTool({ name: `termous.desktop_workflows.${name}`, arguments: { ...args, ...(mutation ? { client_request_id: `workflow-fixture-${++serial}` } : {}) } })
    assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent))
    return result
  }
  const wait = async (run, predicate) => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const report = (await call('runs.get', { run_id: run.id, after_revision: run.revision, wait_ms: 1000 })).structuredContent.report
      run = report.run
      if (predicate(run)) return report
      assert.ok(['preparing', 'running', 'paused'].includes(run.state), JSON.stringify(run))
    }
    throw new Error('脚本运行等待超时')
  }
  const shot = (await call('captures.create', { attachment_id: attachment.id }, true)).structuredContent.snapshot
  const rect = { x: 100, y: 100, width: 24, height: 24 }
  const preview = await call('templates.preview', { snapshot_id: shot.snapshot_id, region: rect, coordinate_space: 'desktop' }, true)
  assert.equal(preview.content.filter(item => item.type === 'image').length, 2)
  const temporary = preview.structuredContent.preview
  const asset = (await call('templates.confirm', { preview_id: temporary.preview_id }, true)).structuredContent.asset
  assert.equal(asset.sha256, temporary.sha256)
  const image = { asset_id: asset.id, offset: { x: 0, y: 0 }, region: rect,
    reference_width: shot.metadata.desktop_width, reference_height: shot.metadata.desktop_height }
  const match = (await call('templates.match', { attachment_id: attachment.id, target: image })).structuredContent.match
  assert.equal(match.result.state, 'unique')
  const definition = { schema_version: 1, parameters: [], steps: [
    { id: 'shot', name: '截图', kind: 'capture', action: {} },
    { id: 'assert', name: '图像断言', kind: 'image.assert', image, action: {} },
    { id: 'click', name: '图像点击', kind: 'pointer.click', target: { kind: 'image', image }, action: { count: 2 } },
    { id: 'text', name: '中文输入', kind: 'keyboard.text', action: { text: 'Termous Workflow MCP 中文' } },
    { id: 'pause', name: '断点', kind: 'breakpoint', action: {} },
  ] }
  const script = (await call('create', { name: 'MCP 合成回归', definition }, true)).structuredContent.script
  assert.equal(script.creator.origin, 'mcp')
  const saved = await call('assets.get', { asset_id: asset.id, script_id: script.id, version: 1 })
  assert.equal(saved.content.find(item => item.type === 'image').data, preview.content.find(item => item.type === 'image').data)
  const start = { script_id: script.id, version: 1, session_id: session.id, connection_generation: session.connection_generation }
  const run = (await call('runs.start', start, true)).structuredContent.run
  const paused = await wait(run, run => run.state === 'paused')
  assert.equal(paused.run.initiator.origin, 'mcp')
  const continuing = (await call('runs.control', { run_id: run.id, action: 'resume' }, true)).structuredContent.run
  const report = await wait(continuing, run => run.state === 'completed')
  assert.equal(report.run.assertions, 1)
  const evidence = report.steps.find(step => step.asset_id)
  assert.ok(evidence)
  assert.ok((await call('assets.get', { run_id: run.id, asset_id: evidence.asset_id })).content.some(item => item.type === 'image'))
  await call('captures.release', { snapshot_id: shot.snapshot_id }, true)
  await call('delete', { script_id: script.id, expected_revision: 1 }, true)
  return { run_id: run.id, state: report.run.state, assertions: report.run.assertions }
}
