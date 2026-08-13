import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeTerminalControlMessage,
  decodeTerminalOutputFrame,
  encodeTerminalAttach,
  encodeTerminalCwdChange,
  encodeTerminalCwdRefresh,
  encodeTerminalHeartbeatAck,
  encodeTerminalResize,
  parseTerminalStreamOffset,
  TerminalProtocolError,
} from '../features/terminal/model/terminalProtocol.ts'

const epoch = '00112233445566778899aabbccddeeff'

test('attach 使用服务端流游标恢复且空游标不携带伪字段', () => {
  assert.deepEqual(JSON.parse(encodeTerminalAttach()), { type: 'attach' })
  assert.deepEqual(JSON.parse(encodeTerminalAttach({
    epoch,
    nextOffset: 42n,
  })), {
    type: 'attach',
    stream_epoch: epoch,
    last_offset: '42',
  })
})

test('终端尺寸只编码正安全整数', () => {
  assert.deepEqual(JSON.parse(encodeTerminalResize(120, 36)), {
    type: 'resize',
    cols: 120,
    rows: 36,
  })
  for (const [cols, rows] of [
    [0, 36],
    [-1, 36],
    [120, 0],
    [Number.MAX_SAFE_INTEGER + 1, 36],
  ]) {
    assert.throws(() => encodeTerminalResize(cols, rows), TerminalProtocolError)
  }
})

test('CWD 请求只编码 operation id、base revision、文件会话和路径', () => {
  assert.deepEqual(JSON.parse(encodeTerminalCwdChange({
    operation_id: 'cwd-operation',
    base_revision: 7,
    file_session_id: 'file-session',
    path: '/srv/ data\\set ',
  })), {
    type: 'cwd_change',
    cwd_change: {
      operation_id: 'cwd-operation',
      base_revision: 7,
      file_session_id: 'file-session',
      path: '/srv/ data\\set ',
    },
  })
})

test('CWD 刷新请求使用独立消息且错误作用域可被识别', () => {
  assert.deepEqual(JSON.parse(encodeTerminalCwdRefresh('refresh-1')), {
    type: 'cwd_refresh',
    request_id: 'refresh-1',
  })
  assert.deepEqual(decodeTerminalControlMessage(JSON.stringify({
    type: 'request_error',
    scope: 'cwd_refresh',
    request_id: 'refresh-1',
    code: 'CWD_REFRESH_FAILED',
    retryable: true,
    message: '当前目录刷新失败',
  })), {
    type: 'request_error',
    scope: 'cwd_refresh',
    code: 'CWD_REFRESH_FAILED',
    request_id: 'refresh-1',
    retryable: true,
    message: '当前目录刷新失败',
  })
})

test('服务端心跳由客户端使用 heartbeat ack 原样确认', () => {
  const heartbeat = decodeTerminalControlMessage(JSON.stringify({
    type: 'heartbeat',
    sent_at: '2026-07-19T10:00:00.000Z',
  }))
  assert.deepEqual(heartbeat, {
    type: 'heartbeat',
    sent_at: '2026-07-19T10:00:00.000Z',
  })
  assert.deepEqual(
    JSON.parse(encodeTerminalHeartbeatAck('2026-07-19T10:00:00.000Z')),
    {
      type: 'heartbeat_ack',
      sent_at: '2026-07-19T10:00:00.000Z',
    },
  )
})

test('可信提示符边界保留补全所需的全部代际信息', () => {
  const message = decodeTerminalControlMessage(JSON.stringify({
    type: 'prompt_boundary',
    source_generation: 3,
    shell_id: 'shell-zsh-1',
    prompt_generation: 12,
    shell: 'zsh',
    cwd: '/srv/应用',
    input_epoch: 21,
  }))

  assert.deepEqual(message, {
    type: 'prompt_boundary',
    source_generation: 3,
    shell_id: 'shell-zsh-1',
    prompt_generation: 12,
    shell: 'zsh',
    cwd: '/srv/应用',
    input_epoch: 21,
  })
})

test('可信提示符边界接受首个输入代际零值', () => {
  const message = decodeTerminalControlMessage(JSON.stringify({
    type: 'prompt_boundary',
    source_generation: 1,
    shell_id: 'shell-bash-1',
    prompt_generation: 1,
    shell: 'bash',
    cwd: '/root',
    input_epoch: 0,
  }))

  assert.equal(message.type, 'prompt_boundary')
  if (message.type !== 'prompt_boundary') {
    assert.fail('首个提示符边界应保持可信消息类型')
  }
  assert.equal(message.input_epoch, 0)
})

test('可信提示符边界保留命令退出码', () => {
  const message = decodeTerminalControlMessage(JSON.stringify({
    type: 'prompt_boundary',
    source_generation: 2,
    shell_id: 'shell-bash-1',
    prompt_generation: 9,
    shell: 'bash',
    cwd: '/root',
    input_epoch: 8,
    exit_code: 127,
  }))
  assert.equal(message.type, 'prompt_boundary')
  if (message.type !== 'prompt_boundary') {
    assert.fail('提示符边界应保持可信消息类型')
  }
  assert.equal(message.exit_code, 127)
})

test('提示符边界拒绝缺失字段和负代际', () => {
  assert.throws(() => decodeTerminalControlMessage(JSON.stringify({
    type: 'prompt_boundary',
    source_generation: -1,
    shell_id: 'shell-bash-1',
    prompt_generation: 1,
    shell: 'bash',
    cwd: '/root',
    input_epoch: 0,
  })), TerminalProtocolError)
  assert.throws(() => decodeTerminalControlMessage(JSON.stringify({
    type: 'prompt_boundary',
    source_generation: 1,
    prompt_generation: 1,
    shell: 'bash',
    cwd: '/root',
    input_epoch: 0,
  })), TerminalProtocolError)
})

test('attached 统一解码会话、CWD 与流快照', () => {
  const message = decodeTerminalControlMessage(JSON.stringify({
    type: 'attached',
    session: { id: 'session-1', status: 'connected' },
    cwd_state: { state_seq: 3 },
    stream: {
      epoch,
      oldest_offset: '10',
      next_offset: '30',
      resume_offset: '20',
    },
  }))

  assert.equal(message.type, 'attached')
  if (message.type !== 'attached') {
    assert.fail('attached 消息应保持统一类型')
  }
  assert.equal(message.cwd_state.state_seq, 3)
  assert.equal(message.cwd_state.refresh_seq, 0)
  assert.equal(message.stream.resume_offset, '20')
  assert.equal(message.input_lock, undefined)
})

test('attached 和增量事件接受权威输入锁，旧协议缺失时保持未锁定兼容', () => {
  const attached = decodeTerminalControlMessage(JSON.stringify({
    type: 'attached',
    session: { id: 'session-1', status: 'connected' },
    cwd_state: { state_seq: 3 },
    stream: {
      epoch,
      oldest_offset: '10',
      next_offset: '30',
      resume_offset: '20',
    },
    input_lock: {
      locked: true,
      owner: 'command_dispatch',
      task_id: 'task-1',
      locked_at: '2026-08-12T00:00:00Z',
    },
  }))
  assert.equal(attached.type, 'attached')
  if (attached.type !== 'attached') {
    assert.fail('attached 消息应保持统一类型')
  }
  assert.deepEqual(attached.input_lock, {
    locked: true,
    owner: 'command_dispatch',
    task_id: 'task-1',
    locked_at: '2026-08-12T00:00:00Z',
  })

  assert.deepEqual(decodeTerminalControlMessage(JSON.stringify({
    type: 'input_lock',
    input_lock: { locked: false },
  })), {
    type: 'input_lock',
    input_lock: {
      locked: false,
      owner: undefined,
      task_id: undefined,
      locked_at: undefined,
    },
  })
})

test('兼容 input_state 事件并归一化为 canonical input_lock', () => {
  assert.deepEqual(decodeTerminalControlMessage(JSON.stringify({
    type: 'input_state',
    input_state: {
      locked: true,
      owner_id: 'task-compatible',
    },
  })), {
    type: 'input_lock',
    input_lock: {
      locked: true,
      owner: 'command_dispatch',
      task_id: 'task-compatible',
      locked_at: undefined,
    },
  })
})

test('旧服务端未发送 refresh sequence 时按零兼容', () => {
  const message = decodeTerminalControlMessage(JSON.stringify({
    type: 'cwd_state',
    cwd_state: { state_seq: 7 },
  }))

  assert.equal(message.type, 'cwd_state')
  if (message.type !== 'cwd_state') {
    assert.fail('CWD 状态消息应保持统一类型')
  }
  assert.equal(message.cwd_state.refresh_seq, 0)
})

test('CWD 状态保留可选观察、控制和刷新事务字段', () => {
  const message = decodeTerminalControlMessage(JSON.stringify({
    type: 'cwd_state',
    cwd_state: {
      state_seq: 8,
      refresh_seq: 4,
      observation_status: 'ready',
      control_status: 'preparing',
      control_code: 'CWD_NOT_READY',
      control_retryable: true,
      refresh_request_id: 'cwd-refresh-current',
      refresh_status: 'pending',
    },
  }))
  assert.equal(message.type, 'cwd_state')
  if (message.type !== 'cwd_state') {
    assert.fail('CWD 状态消息应保持统一类型')
  }
  assert.equal(message.cwd_state.observation_status, 'ready')
  assert.equal(message.cwd_state.control_status, 'preparing')
  assert.equal(message.cwd_state.refresh_request_id, 'cwd-refresh-current')
  assert.equal(message.cwd_state.refresh_status, 'pending')
})

test('decoder 拒绝旧消息名和缺少 state sequence 的 CWD 状态', () => {
  assert.throws(
    () => decodeTerminalControlMessage(JSON.stringify({ type: 'snapshot' })),
    TerminalProtocolError,
  )
  assert.throws(
    () => decodeTerminalControlMessage(JSON.stringify({
      type: 'cwd_state',
      cwd_state: { revision: 1 },
    })),
    TerminalProtocolError,
  )
  assert.throws(
    () => decodeTerminalControlMessage(JSON.stringify({
      type: 'output',
      data: 'legacy text output',
    })),
    TerminalProtocolError,
  )
})

test('二进制输出帧按 epoch 和 uint64 大端偏移解码', () => {
  const bytes = new Uint8Array(28)
  bytes[0] = 0x01
  for (let index = 0; index < 16; index += 1) {
    bytes[index + 1] = index
  }
  new DataView(bytes.buffer).setBigUint64(17, 42n, false)
  bytes.set([0x61, 0x62, 0x63], 25)

  const frame = decodeTerminalOutputFrame(bytes)
  assert.equal(frame.epoch, '000102030405060708090a0b0c0d0e0f')
  assert.equal(frame.startOffset, 42n)
  assert.deepEqual([...frame.data], [0x61, 0x62, 0x63])
})

test('流偏移严格限制为 uint64 十进制', () => {
  assert.equal(parseTerminalStreamOffset('18446744073709551615'), 2n ** 64n - 1n)
  assert.throws(() => parseTerminalStreamOffset('01'), TerminalProtocolError)
  assert.throws(
    () => parseTerminalStreamOffset('18446744073709551616'),
    TerminalProtocolError,
  )
})
