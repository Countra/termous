import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalSettings } from '#common/contracts'
import {
  shouldFitAfterSettingsChange,
  terminalTheme,
} from './terminalAppearance.ts'

const settings: TerminalSettings = {
  font_family: 'jetbrains_mono',
  font_size: 14,
  line_height: 1.2,
  letter_spacing: 0,
  cursor_style: 'block',
  cursor_blink: true,
  theme_mode: 'follow_app',
  scrollback: 5000,
}

test('终端主题遵循应用主题并允许设置强制覆盖', () => {
  assert.equal(terminalTheme(settings, 'light').background, '#fbfcfe')
  assert.equal(terminalTheme(settings, 'dark').background, '#080a0f')
  assert.equal(
    terminalTheme({ ...settings, theme_mode: 'light' }, 'dark').background,
    '#fbfcfe',
  )
})

test('只有字体度量变化才要求重新适配终端尺寸', () => {
  assert.equal(shouldFitAfterSettingsChange(settings, settings), false)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, font_size: 16 }), true)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, line_height: 1.3 }), true)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, letter_spacing: 1 }), true)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, font_family: 'consolas' }), true)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, cursor_blink: false }), false)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, theme_mode: 'dark' }), false)
  assert.equal(shouldFitAfterSettingsChange(settings, { ...settings, scrollback: 10000 }), false)
})
