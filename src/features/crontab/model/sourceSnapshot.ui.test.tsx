import { describe, expect, it } from 'vitest'
import type { CrontabSnapshot } from '#entities/crontab'
import { requireCrontabSourceSnapshot } from './sourceSnapshot'

const snapshot: CrontabSnapshot = {
  session_id: 'session-a',
  username: 'deploy',
  exists: false,
  revision: 'revision-a',
  jobs: [],
  unmanaged_line_count: 0,
  warnings: [],
  collected_at: '2026-08-11T00:00:00Z',
}

describe('Crontab 原文响应合同', () => {
  it('缺少 content 时拒绝进入或覆盖原文编辑器', () => {
    expect(() => requireCrontabSourceSnapshot(snapshot, 'content missing'))
      .toThrow('content missing')
  })

  it.each(['', '0 2 * * * /usr/bin/true\n'])(
    '接受服务端明确返回的字符串原文 %j',
    (content) => {
      const source = { ...snapshot, content }
      expect(requireCrontabSourceSnapshot(source, 'content missing')).toBe(source)
    },
  )
})
