import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compileShortcutIndex,
  createShortcutChord,
  findShortcutConflicts,
  formatShortcutChord,
  getShortcutReservation,
  MAX_SHORTCUT_BINDINGS,
  normalizeShortcutPlatform,
  resolveEffectiveShortcutBindings,
  setShortcutBindingOverride,
  SHORTCUT_ACTIONS,
  shortcutChordSignature,
  shortcutScopesOverlap,
  validateShortcutBindings,
} from '../features/shortcuts/index.ts'

test('动作注册表稳定包含已批准的动作、作用域和默认键位', () => {
  assert.deepEqual(
    SHORTCUT_ACTIONS.map((action) => [
      action.id,
      action.scope,
      action.defaultBindings.map((chord) => shortcutChordSignature(chord)),
    ]),
    [
      ['app.host_launcher.open', 'app.global', ['control+shift|KeyH']],
      ['terminal.copy_selection', 'terminal.selection', ['primary|KeyC', 'primary+shift|KeyC']],
      ['terminal.paste', 'terminal.writable', ['primary|KeyV', 'primary+shift|KeyV']],
      ['terminal.completion.previous', 'terminal.completion.visible', ['|ArrowUp']],
      ['terminal.completion.next', 'terminal.completion.visible', ['|ArrowDown']],
      ['terminal.completion.accept', 'terminal.completion.visible', ['|Enter']],
      ['terminal.search.open', 'terminal.active', []],
      ['terminal.select_all', 'terminal.active', []],
      ['terminal.session.reconnect', 'terminal.disconnected', []],
      ['files.select_all', 'files.standalone', ['primary|KeyA']],
      ['files.open_focused', 'files.list', ['|Enter']],
      ['files.rename_focused', 'files.standalone', ['|F2']],
      ['files.delete_selection', 'files.standalone', ['|Delete']],
      ['files.editor.save', 'files.editor', ['primary|KeyS']],
    ],
  )
  assert.ok(SHORTCUT_ACTIONS.every((action) => (
    action.defaultBindings.length <= MAX_SHORTCUT_BINDINGS
    && action.customizable
    && action.conflictDomains.length > 0
  )))
  assert.equal(
    SHORTCUT_ACTIONS.find((action) => action.id === 'terminal.completion.next')?.allowRepeat,
    true,
  )
})

test('Primary 按平台映射并使用对应平台格式', () => {
  const copy = createShortcutChord('KeyC', 'c', ['primary'])
  assert.equal(formatShortcutChord(copy, 'win32'), 'Ctrl+C')
  assert.equal(formatShortcutChord(copy, 'linux'), 'Ctrl+C')
  assert.equal(formatShortcutChord(copy, 'darwin'), '⌘C')
  assert.equal(
    formatShortcutChord(
      createShortcutChord('KeyH', 'H', ['control', 'shift']),
      'darwin',
    ),
    '⌃⇧H',
  )
  assert.equal(normalizeShortcutPlatform('MacIntel'), 'darwin')
  assert.equal(normalizeShortcutPlatform('Windows'), 'win32')
})

test('冲突域只把可能同时激活的作用域视为重叠', () => {
  assert.equal(shortcutScopesOverlap('app.global', 'files.editor'), true)
  assert.equal(shortcutScopesOverlap('terminal.selection', 'terminal.disconnected'), true)
  assert.equal(shortcutScopesOverlap('terminal.completion.visible', 'terminal.active'), true)
  assert.equal(shortcutScopesOverlap('terminal.completion.visible', 'terminal.selection'), true)
  assert.equal(shortcutScopesOverlap('terminal.writable', 'terminal.disconnected'), false)
  assert.equal(shortcutScopesOverlap('files.standalone', 'files.list'), true)
  assert.equal(shortcutScopesOverlap('files.editor', 'files.list'), false)
  assert.equal(shortcutScopesOverlap('terminal.active', 'files.list'), false)
  assert.deepEqual(findShortcutConflicts({}, 'win32'), [])

  const pasteChord = createShortcutChord('KeyV', 'v', ['primary'])
  const terminalOverride = setShortcutBindingOverride(
    {},
    'terminal.search.open',
    [pasteChord],
  )
  assert.deepEqual(
    findShortcutConflicts(terminalOverride, 'win32').map((conflict) => [
      conflict.firstActionId,
      conflict.secondActionId,
    ]),
    [['terminal.paste', 'terminal.search.open']],
  )

  const editorOverride = setShortcutBindingOverride(
    {},
    'files.editor.save',
    [createShortcutChord('KeyA', 'a', ['primary'])],
  )
  assert.deepEqual(findShortcutConflicts(editorOverride, 'win32'), [])
})

test('稀疏覆盖区分继承默认、显式解绑和恢复默认', () => {
  const hostDefault = createShortcutChord('KeyH', 'H', ['control', 'shift'])
  assert.deepEqual(
    setShortcutBindingOverride({}, 'app.host_launcher.open', [hostDefault]),
    {},
  )

  const disabled = setShortcutBindingOverride({}, 'app.host_launcher.open', [])
  const effective = resolveEffectiveShortcutBindings(disabled)
    .find((entry) => entry.actionId === 'app.host_launcher.open')
  assert.equal(effective?.source, 'override')
  assert.deepEqual(effective?.bindings, [])

  const index = compileShortcutIndex(disabled, 'win32')
  assert.equal(index.byChord.has('control+shift|KeyH'), false)
})

test('保留键覆盖固定入口与各上下文原生交互，同时放行批准默认键', () => {
  const tab = createShortcutChord('Tab', 'Tab')
  assert.equal(getShortcutReservation('app.host_launcher.open', tab, 'win32')?.id, 'focus_traversal')
  assert.equal(
    getShortcutReservation(
      'app.host_launcher.open',
      createShortcutChord('KeyF', 'F', ['control', 'alt', 'shift']),
      'win32',
    )?.id,
    'diagnostics',
  )
  assert.equal(
    getShortcutReservation(
      'terminal.search.open',
      createShortcutChord('Enter', 'Enter'),
      'win32',
    )?.id,
    'terminal_search',
  )
  assert.equal(
    getShortcutReservation(
      'terminal.paste',
      createShortcutChord('KeyC', 'c', ['control']),
      'win32',
    )?.id,
    'terminal_interrupt',
  )
  assert.equal(
    getShortcutReservation(
      'files.select_all',
      createShortcutChord('Space', ' '),
      'win32',
    )?.id,
    'file_selection',
  )
  assert.equal(
    getShortcutReservation(
      'files.editor.save',
      createShortcutChord('KeyF', 'f', ['primary']),
      'win32',
    )?.id,
    'code_editor',
  )

  assert.equal(
    getShortcutReservation(
      'terminal.completion.previous',
      createShortcutChord('ArrowUp', 'ArrowUp'),
      'win32',
    ),
    null,
  )
  assert.equal(
    getShortcutReservation(
      'files.open_focused',
      createShortcutChord('Enter', 'Enter'),
      'win32',
    ),
    null,
  )
  assert.equal(
    getShortcutReservation(
      'files.editor.save',
      createShortcutChord('KeyS', 's', ['primary']),
      'win32',
    ),
    null,
  )
})

test('绑定验证拒绝超过两个、平台等价重复和保留键', () => {
  const issues = validateShortcutBindings(
    'terminal.search.open',
    [
      createShortcutChord('KeyQ', 'q', ['primary']),
      createShortcutChord('KeyQ', 'q', ['control']),
      createShortcutChord('Escape', 'Escape'),
    ],
    'win32',
  )
  assert.deepEqual(issues.map((issue) => issue.code), [
    'too_many_bindings',
    'duplicate_binding',
    'reserved_binding',
  ])
})
