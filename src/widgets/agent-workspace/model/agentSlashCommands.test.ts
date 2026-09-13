import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentSlashCandidateCatalog } from '#entities/agent'
import {
  agentSlashMenuAvailableHeight,
  agentSlashCandidates,
  agentSlashMenuReducer,
  consumeAgentSlashCapture,
  filterAgentSlashCandidates,
  isAgentSlashInsertTextActivation,
  moveAgentSlashActiveId,
  parseAgentSlashInput,
} from './agentSlashCommands.ts'

describe('Agent Slash 命令解析', () => {
  const parseCases: Array<[string, string, string | undefined, string, number, number?]> = [
    ['/', '', undefined, '/', 1],
    ['/se', 'se', undefined, '/se', 3],
    ['/session', 'session', 'session', '/session', 8],
    ['/profile 后续正文', 'profile', 'profile', '/profile ', 9],
    ['/compact\n下一行', 'compact', 'compact', '/compact\n', 9],
    ['/session\r\n下一行', 'session', 'session', '/session\r\n', 10],
    ['before /profile after', 'profile', 'profile', '/profile ', 16, 7],
  ]
  for (const [value, query, exact, fragment, end, captureStart = 0] of parseCases) {
    it(`解析 ${JSON.stringify(value)} 并精确捕获可消费片段`, () => {
      const parsed = parseAgentSlashInput(value, 'session-a', captureStart)
      assert.equal(parsed?.query, query)
      assert.equal(parsed?.exact_command_id, exact)
      assert.deepEqual(parsed?.capture, { owner: 'session-a', start: captureStart, end, raw_fragment: fragment })
    })
  }

  for (const value of [
    ' /session',
    '/unknown',
    '/Session',
    '/session/path',
    '/session\r正文',
    '/se 正文',
  ]) {
    it(`拒绝普通正文或不完整边界 ${JSON.stringify(value)}`, () => {
      assert.equal(parseAgentSlashInput(value, 'session-a'), null)
    })
  }

  it('只有直接键入且命令位于开头或 ASCII 空格后时允许激活', () => {
    const input = {
      value: '', owner: 'session-a', start: 0, end: 0, data: '/', inputType: 'insertText', isComposing: false,
    }
    assert.equal(isAgentSlashInsertTextActivation(input), true)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, inputType: 'insertFromPaste' }), false)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, inputType: 'historyUndo' }), false)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, isComposing: true }), false)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, value: '正文 ', start: 3, end: 3 }), true)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, value: '正文', start: 2, end: 2 }), false)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, value: '正文\n', start: 3, end: 3 }), false)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, value: '正文　', start: 3, end: 3 }), false)
    assert.equal(isAgentSlashInsertTextActivation({ ...input, value: '/', start: 1, end: 1, data: 's' }), false)
  })

  it('只删除命令和一个分隔符，并通过 owner 与原片段保护异步消费', () => {
    const capture = parseAgentSlashInput('/session  保留空格', 'session-a')!.capture
    assert.equal(consumeAgentSlashCapture('/session  保留空格', 'session-a', capture), ' 保留空格')
    assert.equal(consumeAgentSlashCapture('/profile  保留空格', 'session-a', capture), null)
    assert.equal(consumeAgentSlashCapture('/session  保留空格', 'session-b', capture), null)

    const inline = parseAgentSlashInput('已有内容 /session 后续', 'session-a', 5)!.capture
    assert.equal(consumeAgentSlashCapture('已有内容 /session 后续', 'session-a', inline), '已有内容 后续')
  })
})

describe('Agent Slash 菜单状态机', () => {
  it('按根命令、资源类型、候选逐层进入并逐级返回', () => {
    const parsed = parseAgentSlashInput('/session', 'session-a')!
    let state = agentSlashMenuReducer({ level: 'closed' }, {
      type: 'open', parsed, active_id: 'session',
    })
    state = agentSlashMenuReducer(state, {
      type: 'open_kind', command_id: 'session', active_id: 'ssh',
    })
    assert.deepEqual(state, { level: 'kind', capture: parsed.capture, command_id: 'session', active_id: 'ssh' })
    state = agentSlashMenuReducer(state, {
      type: 'open_resource', resource_kind: 'ssh', active_id: 'ssh-one',
    })
    assert.deepEqual(state, {
      level: 'resource', capture: parsed.capture, command_id: 'session', resource_kind: 'ssh',
      query: '', active_id: 'ssh-one',
    })
    state = agentSlashMenuReducer(state, { type: 'back', active_id: 'ssh' })
    assert.equal(state.level, 'kind')
    assert.equal(state.active_id, 'ssh')
    state = agentSlashMenuReducer(state, { type: 'back', active_id: 'session' })
    assert.equal(state.level, 'root')
    assert.equal(state.active_id, 'session')
    assert.deepEqual(agentSlashMenuReducer(state, { type: 'back' }), { level: 'closed' })
  })

  it('方向选择循环并支持首尾定位', () => {
    const ids = ['one', 'two', 'three']
    assert.equal(moveAgentSlashActiveId(ids, 'one', 'previous'), 'three')
    assert.equal(moveAgentSlashActiveId(ids, 'three', 'next'), 'one')
    assert.equal(moveAgentSlashActiveId(ids, 'two', 'first'), 'one')
    assert.equal(moveAgentSlashActiveId(ids, 'two', 'last'), 'three')
    assert.equal(moveAgentSlashActiveId([], 'one', 'next'), undefined)
  })

  it('从类型层返回时恢复原始命令前缀对应的根层候选', () => {
    const parsed = parseAgentSlashInput('/', 'session-a')!
    let state = agentSlashMenuReducer({ level: 'closed' }, {
      type: 'open', parsed, active_id: 'session',
    })
    state = agentSlashMenuReducer(state, {
      type: 'open_kind', command_id: 'session', active_id: 'ssh',
    })
    state = agentSlashMenuReducer(state, { type: 'back', active_id: 'session' })

    assert.equal(state.level, 'root')
    if (state.level !== 'root') return
    assert.equal(state.query, '')
    assert.deepEqual(state.matching_command_ids, ['session', 'profile', 'compact'])
    assert.equal(state.active_id, 'session')
  })
})

it('上拉面板按工作区与视口顶边保留十二像素并限制最大高度', () => {
  assert.equal(agentSlashMenuAvailableHeight(600, 100), 360)
  assert.equal(agentSlashMenuAvailableHeight(300, 100), 180)
  assert.equal(agentSlashMenuAvailableHeight(100, 0), 80)
  assert.equal(agentSlashMenuAvailableHeight(10, 0), 0)
})

describe('Agent Slash 候选目录', () => {
  const catalog: AgentSlashCandidateCatalog = {
    session: {
      ssh: [{
        id: 'ssh-session-a', kind: 'ssh_session', resource_kind: 'ssh', session_id: 'session-a',
        host_id: 'host-a', host_name: 'Production', profile_id: 'profile-a', profile_name: 'Deploy',
        ssh_profile_id: 'profile-a', started_at: '2026-09-12T00:00:00Z', status: 'ready', current: false,
      }],
      file: [],
    },
    profile: {
      ssh: [],
      file: [{
        id: 'file-profile-a', kind: 'file_profile', resource_kind: 'file', host_id: 'host-local',
        host_name: 'Local Files', profile_id: 'profile-files', profile_name: 'Workspace',
        file_access_profile_id: 'profile-files', sort_order: 0, status: 'ready', current: true,
      }],
    },
  }

  it('按命令与类型取窄候选，并搜索主机、配置和稳定标识', () => {
    const ssh = agentSlashCandidates(catalog, 'session', 'ssh')
    assert.equal(ssh.length, 1)
    assert.deepEqual(filterAgentSlashCandidates(ssh, 'prod'), ssh)
    assert.deepEqual(filterAgentSlashCandidates(ssh, 'deploy'), ssh)
    assert.deepEqual(filterAgentSlashCandidates(ssh, 'session-a'), ssh)
    assert.deepEqual(filterAgentSlashCandidates(ssh, 'missing'), [])
    assert.equal(agentSlashCandidates(catalog, 'profile', 'file')[0]?.current, true)
  })
})
