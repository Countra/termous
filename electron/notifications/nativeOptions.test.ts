import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeNotificationOptions } from './nativeOptions.ts'

test('Windows toast 显式携带激活 ID，正文与路径不能注入 XML', () => {
  const options = nativeNotificationOptions('<任务>', 'A&B"', 'stable-id', 'C:/Termous/icon.png', 'win32')
  assert.match(options.toastXml!, /launch="type=click&amp;tag=stable-id"/)
  assert.match(options.toastXml!, /&lt;任务&gt;/)
  assert.match(options.toastXml!, /A&amp;B&quot;/)
  assert.equal(nativeNotificationOptions('x', 'y', 'id', 'icon', 'darwin').toastXml, undefined)
})
