import assert from 'node:assert/strict'
import test from 'node:test'
import { terminalContextMenuShortcutAction } from './terminalContextMenuShortcuts.ts'

test('终端菜单只为已纳入统一管理的动作映射快捷键', () => {
  assert.equal(terminalContextMenuShortcutAction('reconnect'), 'terminal.session.reconnect')
  assert.equal(terminalContextMenuShortcutAction('copy_selection'), 'terminal.copy_selection')
  assert.equal(terminalContextMenuShortcutAction('find_selection'), 'terminal.search.open')
  assert.equal(terminalContextMenuShortcutAction('find'), 'terminal.search.open')
  assert.equal(terminalContextMenuShortcutAction('paste'), 'terminal.paste')
  assert.equal(terminalContextMenuShortcutAction('select_all'), 'terminal.select_all')
  assert.equal(terminalContextMenuShortcutAction('clear'), null)
  assert.equal(terminalContextMenuShortcutAction('open_link'), null)
  assert.equal(terminalContextMenuShortcutAction('open_path'), null)
})
