import { describe, expect, it } from 'vitest'
import { TermousApiError } from '#shared/api'
import { isCrontabWriteUncertainError } from './mutationErrors'

describe('Crontab 写入结果不确定分类', () => {
  it.each([
    ['CRONTAB_WRITE_UNCERTAIN', 502],
    ['REQUEST_TIMEOUT', 0],
    ['NETWORK_ERROR', 0],
  ])('将 %s 识别为必须重新读取的结果不确定错误', (code, status) => {
    expect(isCrontabWriteUncertainError(new TermousApiError('failed', code, status))).toBe(true)
  })

  it.each([
    ['CRONTAB_CONFLICT', 409],
    ['REQUEST_ABORTED', 0],
    ['REQUEST_TIMEOUT', 504],
  ])('不会把 %s 的非不确定场景扩大为写入结果未知', (code, status) => {
    expect(isCrontabWriteUncertainError(new TermousApiError('failed', code, status))).toBe(false)
  })
})
