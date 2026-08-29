import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { isAgentWorkerOutboundMessage } from './protocol.ts'

const steerAck = {
  type: 'steer_ack',
  protocol_version: agentRuntimeProtocolVersion,
  run_id: 'agr_test',
  generation: 1,
  client_request_id: 'agsr_request-1',
  accepted: true,
}

test('Worker steer ack 严格校验请求标识与错误分支', () => {
  assert.equal(isAgentWorkerOutboundMessage(steerAck), true)
  assert.equal(isAgentWorkerOutboundMessage({
    ...steerAck,
    client_request_id: '../invalid',
  }), false)
  assert.equal(isAgentWorkerOutboundMessage({
    ...steerAck,
    accepted: false,
  }), false)
  assert.equal(isAgentWorkerOutboundMessage({
    ...steerAck,
    accepted: false,
    error_code: 'AGENT_RUNTIME_STEER_CLOSED',
  }), true)
  assert.equal(isAgentWorkerOutboundMessage({
    ...steerAck,
    error_code: 'AGENT_RUNTIME_STEER_CLOSED',
  }), false)
})
