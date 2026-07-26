import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideRuntimeSummaryReport,
  normalizeRuntimeSummaryRefreshRequest,
  normalizeRuntimeSummaryReportContext,
} from './updateRuntimeSummaryRefresh.ts'

const refresh = {
  senderId: 7,
  requestId: 'request-current',
  documentEpoch: 'document-current',
}

test('主动刷新只接受同一发送方、文档代际和请求标识的报告', () => {
  const base = {
    senderId: 7,
    currentSenderId: 7,
    currentDocumentEpoch: 'document-current',
    refresh,
  }

  assert.deepEqual(decideRuntimeSummaryReport({
    ...base,
    context: {
      request_id: 'request-current',
      document_epoch: 'document-current',
    },
  }), {
    accept: true,
    completes_refresh: true,
  })
  assert.equal(decideRuntimeSummaryReport({
    ...base,
    context: { document_epoch: 'document-current' },
  }).accept, false)
  assert.equal(decideRuntimeSummaryReport({
    ...base,
    context: {
      request_id: 'request-old',
      document_epoch: 'document-current',
    },
  }).accept, false)
  assert.equal(decideRuntimeSummaryReport({
    ...base,
    context: {
      request_id: 'request-current',
      document_epoch: 'document-old',
    },
  }).accept, false)
})

test('普通心跳只在当前文档且没有刷新事务时更新摘要', () => {
  const base = {
    senderId: 7,
    currentSenderId: 7,
    currentDocumentEpoch: 'document-current',
    refresh: null,
  }

  assert.deepEqual(decideRuntimeSummaryReport({
    ...base,
    context: { document_epoch: 'document-current' },
  }), {
    accept: true,
    completes_refresh: false,
  })
  assert.equal(decideRuntimeSummaryReport({
    ...base,
    context: {
      request_id: 'request-late',
      document_epoch: 'document-current',
    },
  }).accept, false)
  assert.equal(decideRuntimeSummaryReport({
    ...base,
    context: null,
  }).accept, false)
})

test('刷新请求和报告上下文拒绝缺失或异常标识', () => {
  assert.deepEqual(normalizeRuntimeSummaryRefreshRequest({
    request_id: 'request-current',
    document_epoch: 'document-current',
  }), {
    request_id: 'request-current',
    document_epoch: 'document-current',
  })
  assert.equal(normalizeRuntimeSummaryRefreshRequest({
    request_id: '',
    document_epoch: 'document-current',
  }), null)
  assert.deepEqual(normalizeRuntimeSummaryReportContext({
    document_epoch: 'document-current',
  }), {
    document_epoch: 'document-current',
  })
  assert.equal(normalizeRuntimeSummaryReportContext({
    request_id: 1,
    document_epoch: 'document-current',
  }), null)
})
