import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeTerminalControlMessage,
  decodeTerminalOutputFrame,
  encodeTerminalAttach,
  encodeTerminalCwdChange,
  encodeTerminalHeartbeatAck,
  parseTerminalStreamOffset,
  TerminalProtocolError,
} from '../features/terminal/terminalProtocol.ts'

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
  assert.equal(message.stream.resume_offset, '20')
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
