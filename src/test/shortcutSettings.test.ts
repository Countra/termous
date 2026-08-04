import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyShortcutSettingsPatch,
  defaultShortcutSettings,
  normalizeShortcutSettings,
  shortcutSettingsEqual,
} from '../features/settings/shortcutSettings.ts'
import { normalizeSettings } from '../features/settings/terminalSettings.ts'

test('旧设置缺少快捷键字段时使用空覆盖', () => {
  const settings = normalizeSettings({ language: 'zh-CN' })

  assert.deepEqual(settings.shortcuts, defaultShortcutSettings)
  assert.notEqual(settings.shortcuts, defaultShortcutSettings)
  assert.notEqual(settings.shortcuts.overrides, defaultShortcutSettings.overrides)
})

test('显式空绑定与未知合法动作可无损归一化', () => {
  const settings = normalizeShortcutSettings({
    schema_version: 1,
    overrides: {
      'terminal.search.open': { bindings: [] },
      'future.workspace.action': {
        bindings: [{ modifiers: ['shift', 'primary'], code: 'KeyK', key: 'k' }],
      },
    },
  })

  assert.deepEqual(settings.overrides['terminal.search.open'], { bindings: [] })
  assert.deepEqual(settings.overrides['future.workspace.action'], {
    bindings: [{ modifiers: ['primary', 'shift'], code: 'KeyK', key: 'k' }],
  })
})

test('增量变更区分主动解绑与恢复默认', () => {
  const current = normalizeShortcutSettings({
    overrides: {
      'terminal.search.open': {
        bindings: [{ modifiers: ['primary'], code: 'KeyF', key: 'f' }],
      },
      'terminal.select_all': { bindings: [] },
    },
  })
  const next = applyShortcutSettingsPatch(current, {
    changes: {
      'terminal.search.open': { bindings: [] },
      'terminal.select_all': null,
    },
  })

  assert.deepEqual(next.overrides['terminal.search.open'], { bindings: [] })
  assert.equal(next.overrides['terminal.select_all'], undefined)
})

test('快捷键设置比较不受对象和绑定插入顺序影响', () => {
  const left = normalizeShortcutSettings({
    overrides: {
      'terminal.paste': {
        bindings: [
          { modifiers: ['primary', 'shift'], code: 'KeyV', key: 'v' },
          { modifiers: ['primary'], code: 'KeyV', key: 'v' },
        ],
      },
      'terminal.search.open': { bindings: [] },
    },
  })
  const right = normalizeShortcutSettings({
    overrides: {
      'terminal.search.open': { bindings: [] },
      'terminal.paste': {
        bindings: [
          { modifiers: ['primary'], code: 'KeyV', key: 'v' },
          { modifiers: ['shift', 'primary'], code: 'KeyV', key: 'v' },
        ],
      },
    },
  })

  assert.equal(shortcutSettingsEqual(left, right), true)
})

test('同一物理按键不会因 key 大小写差异保存为两组绑定', () => {
  const settings = normalizeShortcutSettings({
    overrides: {
      'terminal.copy_selection': {
        bindings: [
          { modifiers: ['primary'], code: 'KeyC', key: 'c' },
          { modifiers: ['primary'], code: 'KeyC', key: 'C' },
        ],
      },
    },
  })

  assert.equal(settings.overrides['terminal.copy_selection'], undefined)
})

test('设置归一化拒绝运行时无法触发的修饰键和未知按键 code', () => {
  const settings = normalizeShortcutSettings({
    overrides: {
      'terminal.search.open': {
        bindings: [{ modifiers: [], code: 'ControlLeft', key: 'Control' }],
      },
      'terminal.select_all': {
        bindings: [{ modifiers: [], code: 'Unidentified', key: 'x' }],
      },
    },
  })

  assert.equal(settings.overrides['terminal.search.open'], undefined)
  assert.equal(settings.overrides['terminal.select_all'], undefined)
})
