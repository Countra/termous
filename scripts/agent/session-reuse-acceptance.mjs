import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

// 只执行延时步骤；审批仅限本次创建的脚本，不批准用户的其他请求。
export async function verifySessionReuse({ api, core, profile, model, protocol, skills, run, report, save, setDesktop, live = false }) {
  const seen = new Set(), removed = new Set()
  const beforeSessions = (await api('/remote-desktop-sessions')).filter((item) => item.profile_id === profile)
  const beforeIDs = new Set(beforeSessions.map((item) => item.id))
  const events = new WebSocket(`${core.replace('http:', 'ws:')}/api/v1/remote-desktop-sessions/events`, { headers: { 'X-Termous-Token': 'dev-token' } })
  let eventError
  events.on('error', (error) => { eventError = error.message })
  const initial = new Promise((resolve, reject) => {
    events.once('error', reject)
    events.on('message', (raw) => {
      const event = JSON.parse(raw.toString())
      for (const item of [...(event.sessions ?? []), ...(event.session ? [event.session] : [])]) {
        if (item.profile_id === profile) seen.add(item.id)
      }
      const removedID = event.session?.id ?? event.session_id
      if (event.type === 'removed' && seen.has(removedID)) removed.add(removedID)
      if (event.type === 'snapshot') resolve()
    })
  })
  const script = await api('/desktop-workflows', 'POST', { name: '会话复用验收', expected_revision: 0, definition: { schema_version: 1, parameters: [], steps: [{ id: 'delay', name: '无输入延时', kind: 'delay', action: {} }] } })
  report.script_id = script.id
  const approve = async () => {
    const snapshot = await api('/mcp/approvals')
    for (const approval of snapshot.items ?? []) {
      if (approval.state === 'pending' && approval.operation?.script_id === script.id && approval.operation?.action === 'run') {
        await api(`/mcp/approvals/${approval.id}/decisions`, 'POST', { decision: 'approve', expected_revision: approval.revision })
      }
    }
  }
  const waitRun = async (id, predicate) => {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const value = await api(`/desktop-workflow-runs/${id}`)
      if (predicate(value.run)) return value.run
      assert.ok(['preparing', 'running', 'paused'].includes(value.run.state), JSON.stringify(value.run))
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('本机 workflow 等待超时')
  }
  let sessionID
  try {
    await Promise.race([initial, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('会话事件订阅超时')), 10000); timer.unref() })])
    if (!live) assert.equal(seen.size, 0, '新建夹具 Profile 不应已有会话')
    for (let index = 0; index < 3; index++) {
      const selected = index === 1 ? await api(`/remote-desktop-sessions/${sessionID}`) : undefined
      const reference = selected ? { kind: 'desktop_session', session_id: selected.id, connection_generation: selected.connection_generation } : { kind: 'desktop_profile', desktop_profile_id: profile }
      const session = await api('/agent/sessions', 'POST', { title: `会话复用验收 ${index + 1}`, model_id: model.id, reasoning_level: 'low', resource_reference: reference })
      report.sessions.push(session.id)
      const entry = { profile_id: profile, scenario: [beforeIDs.size ? 'existing-session-first' : 'no-session', 'existing-session', 'history-continuation'][index], runs: [] }
      report.cases.push(entry)
      const instruction = `请运行已有桌面脚本 ${script.id} 的固定版本 1，目标为本轮绑定的精确 Profile。脚本已审核，只有一个无输入延时步骤。优先复用该 Profile 的已有会话，默认保留连接；等待完成后报告真实结果。不要修改脚本，不执行其他桌面输入。`
      if (index === 2) {
        const first = await run(session, `${instruction} 但现在先仅观察当前桌面一次，然后等待我说继续；这一轮不要运行脚本。`, protocol, skills, approve)
        entry.runs.push(first)
        assert.equal(first.status, 'completed')
        assert.ok(first.successful_tools.includes('termous.desktops.capture'))
      }
      const before = new Set((await api('/desktop-workflow-runs')).map((item) => item.id))
      const result = await run(session, index === 2 ? '继续执行之前指定的固定版本脚本，复用刚才的桌面会话并保留连接，等待终态。' : instruction, protocol, skills, approve)
      entry.runs.push(result)
      assert.equal(result.status, 'completed', JSON.stringify(result))
      assert.ok(result.successful_tools.includes('termous.desktop_workflows.runs.start'), '模型没有启动 workflow')
      const runs = (await api('/desktop-workflow-runs')).filter((item) => item.script_id === script.id && !before.has(item.id))
      assert.equal(runs.length, 1, '模型不应重复执行脚本')
      assert.equal(runs[0].state, 'completed', JSON.stringify(runs[0]))
      const current = (await api('/remote-desktop-sessions')).filter((item) => item.profile_id === profile)
      assert.equal(current.length, Math.max(1, beforeIDs.size))
      sessionID ??= runs[0].session_id
      assert.ok(current.some((item) => item.id === sessionID))
      if (beforeIDs.size) assert.ok(beforeIDs.has(sessionID))
      assert.equal(runs[0].session_id, sessionID)
      if (!live) setDesktop(current[0])
      entry.session_id = sessionID
      entry.workflow_run_id = runs[0].id
      const target = result.tool_targets.find((call) => call.name === 'termous.desktop_workflows.runs.start')
      assert.ok(target && (target.session_id === sessionID || !selected && target.profile_id === profile), '模型提交了不匹配的执行目标')
      entry.target_route = target.session_id ? 'verified-session' : 'core-profile-resolver'
      entry.success = true
      await save()
      console.log(JSON.stringify({ scenario: entry.scenario, session_id: sessionID, success: true }))
    }
    for (const options of [{ debug: true }, { keep_connection: false }]) {
      const started = await api('/desktop-workflow-runs', 'POST', { script_id: script.id, version: 1, request_id: randomUUID(), profile_id: profile, ...options })
      if (options.debug) {
        const paused = await waitRun(started.id, (value) => value.state === 'paused')
        assert.equal(paused.session_id, sessionID)
        await api(`/desktop-workflow-runs/${started.id}/control`, 'POST', { request_id: randomUUID(), action: 'resume' })
      }
      const finished = await waitRun(started.id, (value) => value.state === 'completed')
      assert.equal(finished.session_id, sessionID)
      assert.equal((await api(`/remote-desktop-sessions/${sessionID}`)).id, sessionID)
      report.cases.push({ profile_id: profile, scenario: options.debug ? 'http-debug' : 'http-explicit-false-reuse', session_id: sessionID, workflow_run_id: started.id, success: true })
    }
    assert.equal(eventError, undefined)
    assert.equal(seen.size, Math.max(1, beforeIDs.size), '创建了多余桌面会话')
    assert.equal(removed.size, 0, '任务结束关闭了已有连接')
    report.session_lifecycles ??= []
    report.session_lifecycles.push({ profile_id: profile, created: [...seen].filter((id) => !beforeIDs.has(id)).length, closed: removed.size, session_ids: [...seen] })
    report.success = report.cases.every((item) => item.success)
  } finally {
    events.close()
    // 真实 Profile 与桌面连接保留；仅清理本次验收脚本和仍在执行的验收任务。
    if (!live) {
      const current = (await api('/remote-desktop-sessions')).filter((item) => item.profile_id === profile)
      if (current.length === 1) setDesktop(current[0])
    }
    const active = (await api('/desktop-workflow-runs')).filter((item) => item.script_id === script.id && ['preparing', 'running', 'paused'].includes(item.state))
    for (const item of active) {
      await api(`/desktop-workflow-runs/${item.id}/control`, 'POST', { request_id: randomUUID(), action: 'cancel' })
      await waitRun(item.id, (value) => !['preparing', 'running', 'paused'].includes(value.state))
    }
    await api(`/desktop-workflows/${script.id}?revision=${script.revision}`, 'DELETE')
  }
}
