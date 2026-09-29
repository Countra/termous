import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeNotification, notificationTarget, notificationText, validateNotificationPreferences, type NotificationMessage } from './notification.ts'

const base: NotificationMessage = { id: 'n', sequence: 1, kind: 'agent', outcome: 'success', occurred_at: new Date().toISOString(), source_id: 'run', session_id: 'session', operation: 'run', completed_files: 0, total_files: 0, skipped_items: 0, native_eligible: true, read: false }

test('会话通知显示标题与可见概览，对外不使用 Agent 名称', () => {
  const message = decodeNotification({ ...base, session_title: '排查网络连接', preview: '已修复连接配置，验证通过。' })
  for (const language of ['zh-CN', 'en-US']) {
    const text = notificationText(message, language)
    assert.doesNotMatch(text.title, /Agent/)
    assert.equal(text.subject, '排查网络连接')
    assert.match(text.body, /排查网络连接\n已修复连接配置/)
  }
  assert.doesNotThrow(() => decodeNotification({ ...base, preview: '🙂'.repeat(160) }))
  assert.throws(() => decodeNotification({ ...base, preview: '🙂'.repeat(161) }))
  assert.match(notificationText(base, 'zh-CN').body, /会话 session/)
})

test('文件通知保留文件名、完成数、传输量、跳过及不确定结果', () => {
  const text = notificationText({ ...base, kind: 'file', outcome: 'uncertain', operation: 'remote_copy', name: 'video.mp4', completed_files: 1, total_files: 2, skipped_items: 1, transferred_bytes: 900 * 1024 ** 2, total_bytes: 1024 ** 3 }, 'zh-CN')
  assert.equal(text.title, '文件复制结果待确认')
  assert.equal(text.subject, 'video.mp4')
  assert.match(text.summary, /完成 1 \/ 2 项.*900 MiB \/ 1 GiB.*跳过 1 项.*核对/)
})

test('审批具有独立受控目标且旧偏好默认启用审批通知', () => {
  const message = decodeNotification({ ...base, kind: 'approval', outcome: 'attention', operation: 'command', expires_at: new Date(Date.now() + 60000).toISOString(), target_count: 2 })
  assert.deepEqual(notificationTarget(message), { kind: 'approval', approval_id: 'run' })
  assert.equal(notificationText(message, 'zh-CN').title, '有命令待审批')
  assert.equal(notificationText(message, 'zh-CN').body, 'AI 助手')
  assert.equal(notificationText(message, 'zh-CN').summary, '')
  assert.equal(notificationText(message, 'en-US').title, 'Command awaiting approval')
  assert.throws(() => decodeNotification({ ...message, expires_at: undefined }))
  assert.deepEqual(validateNotificationPreferences({ enabled: false, agent: false, file: true }), { enabled: false, agent: false, file: true, approval: true, cloud: true })
  assert.throws(() => validateNotificationPreferences({ enabled: true, agent: true, file: true, approval: 'yes' }))
})
