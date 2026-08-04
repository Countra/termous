import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createShortcutChord,
  getShortcutAction,
} from '../features/shortcuts/index.ts'
import {
  buildShortcutSettingsRows,
  createShortcutBindingChange,
  filterShortcutSettingsRows,
  groupShortcutSettingsRows,
  shortcutActionTranslationSegment,
  shortcutScopeTranslationSegment,
  validateShortcutDraft,
} from '../features/settings/shortcutSettingsPanelModel.ts'
import type { ShortcutSettings } from '../types/domain.ts'

const defaultSettings: ShortcutSettings = {
  schema_version: 1,
  overrides: {},
}

test('快捷键设置行稳定按目录分组并区分默认未绑定与主动取消', () => {
  const defaultRows = buildShortcutSettingsRows(defaultSettings, 'win32')
  assert.equal(defaultRows.length, 14)
  assert.deepEqual(
    groupShortcutSettingsRows(defaultRows).map(({ group, rows }) => [group, rows.length]),
    [
      ['global', 1],
      ['terminal', 5],
      ['completion', 3],
      ['files', 4],
      ['editor', 1],
    ],
  )

  const defaultSearch = defaultRows.find(
    (row) => row.definition.id === 'terminal.search.open',
  )
  assert.equal(defaultSearch?.status, 'unbound')
  assert.equal(defaultSearch?.customized, false)

  const overriddenRows = buildShortcutSettingsRows({
    schema_version: 1,
    overrides: {
      'terminal.copy_selection': { bindings: [] },
    },
  }, 'win32')
  const disabledCopy = overriddenRows.find(
    (row) => row.definition.id === 'terminal.copy_selection',
  )
  assert.equal(disabledCopy?.status, 'unbound')
  assert.equal(disabledCopy?.customized, true)
})

test('设置页搜索支持动作、说明和作用域文本且保持注册顺序', () => {
  const rows = buildShortcutSettingsRows(defaultSettings, 'win32')
  const result = filterShortcutSettingsRows(rows, '  当前终端  ', (row) => [
    row.definition.id,
    row.definition.scope === 'terminal.active' ? '当前终端' : '',
  ])
  assert.deepEqual(
    result.map((row) => row.definition.id),
    ['terminal.search.open', 'terminal.select_all'],
  )
})

test('保存默认绑定会移除稀疏覆盖，空列表则保留主动取消', () => {
  const defaults = getShortcutAction('files.editor.save').defaultBindings
  assert.equal(createShortcutBindingChange('files.editor.save', defaults), null)
  assert.deepEqual(
    createShortcutBindingChange('files.editor.save', []),
    { bindings: [] },
  )
})

test('录制草稿统一阻止保留键与重叠上下文冲突', () => {
  const reserved = validateShortcutDraft(
    'terminal.search.open',
    [createShortcutChord('Escape', 'Escape')],
    defaultSettings,
    'win32',
  )
  assert.equal(reserved.valid, false)
  assert.equal(reserved.issues[0]?.code, 'reserved_binding')

  const conflict = validateShortcutDraft(
    'terminal.search.open',
    [createShortcutChord('KeyV', 'v', ['primary'])],
    defaultSettings,
    'win32',
  )
  assert.equal(conflict.valid, false)
  assert.equal(conflict.conflicts[0]?.secondActionId, 'terminal.search.open')

  const isolated = validateShortcutDraft(
    'files.editor.save',
    [createShortcutChord('F5', 'F5')],
    defaultSettings,
    'win32',
  )
  assert.equal(isolated.valid, true)
})

test('动作与作用域翻译段不会把点号交给 i18next 分层解析', () => {
  assert.equal(
    shortcutActionTranslationSegment('terminal.completion.accept'),
    'terminal_completion_accept',
  )
  assert.equal(
    shortcutScopeTranslationSegment('terminal.completion.visible'),
    'terminal_completion_visible',
  )
})

test('外部写入的歧义绑定会标记全部受影响动作', () => {
  const rows = buildShortcutSettingsRows({
    schema_version: 1,
    overrides: {
      'terminal.search.open': {
        bindings: [createShortcutChord('KeyV', 'v', ['primary'])],
      },
    },
  }, 'win32')
  const paste = rows.find((row) => row.definition.id === 'terminal.paste')
  const search = rows.find((row) => row.definition.id === 'terminal.search.open')
  assert.equal(paste?.conflicts.length, 1)
  assert.equal(search?.conflicts.length, 1)
})

test('快捷键录制器通过 Runtime 抢占按键并由组件适配器隔离业务动作', () => {
  const panelSource = readFileSync(
    new URL('../features/settings/ShortcutSettingsPanel.tsx', import.meta.url),
    'utf8',
  )
  const recorderSource = readFileSync(
    new URL('../features/settings/ShortcutRecorderModal.tsx', import.meta.url),
    'utf8',
  )
  assert.match(recorderSource, /runtime\.pushRecorder\(/)
  assert.match(recorderSource, /data-shortcut-adapter="recorder"/)
  assert.match(recorderSource, /runtime\.dispatch\(event\.nativeEvent/)
  assert.match(panelSource, /<Popconfirm/)
  assert.match(recorderSource, /<Modal/)
  assert.match(recorderSource, /<Popconfirm/)
})
