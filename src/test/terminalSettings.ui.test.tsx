import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TermousApi } from '#app/data-runtime'
import {
  defaultTerminalSettings,
  fontFamilyFromSetting,
  loadTerminalFont,
  normalizeTerminalSettings,
  syncImportedFontFaces,
} from '#entities/settings'
import type { TerminalFont } from '#common/contracts'

const importedFontStyleId = 'termous-imported-terminal-fonts'
const originalDocumentFonts = Object.getOwnPropertyDescriptor(document, 'fonts')

const fonts: TerminalFont[] = [
  {
    id: 'jetbrains_mono',
    kind: 'builtin',
    display_name: 'JetBrains Mono',
    family_name: 'JetBrains Mono',
  },
  {
    id: 'custom-font',
    kind: 'imported',
    display_name: 'Custom Mono',
    family_name: 'Custom Mono',
    sha256: 'font-sha',
  },
]

describe('Terminal 字体与配置合同', () => {
  afterEach(() => {
    document.getElementById(importedFontStyleId)?.remove()
    if (originalDocumentFonts) {
      Object.defineProperty(document, 'fonts', originalDocumentFonts)
    } else {
      Reflect.deleteProperty(document, 'fonts')
    }
    vi.restoreAllMocks()
  })

  it('保留 Terminal 设置默认值并归一化边界输入', () => {
    expect(normalizeTerminalSettings(undefined)).toEqual(defaultTerminalSettings)
    expect(normalizeTerminalSettings({
      font_family: '  custom-font  ',
      font_size: 24,
      line_height: 1.274,
      letter_spacing: 1.26,
      cursor_style: 'invalid' as never,
      cursor_blink: false,
      theme_mode: 'invalid' as never,
      scrollback: 1234 as never,
    })).toEqual({
      font_family: 'custom-font',
      font_size: 22,
      line_height: 1.25,
      letter_spacing: 1.5,
      cursor_style: 'block',
      cursor_blink: false,
      theme_mode: 'follow_app',
      scrollback: 5000,
    })
  })

  it('保持内置字体、导入字体与未知字体的回退顺序', () => {
    expect(fontFamilyFromSetting('custom-font', fonts)).toBe(
      '"Custom Mono", "JetBrains Mono", Consolas, monospace',
    )
    expect(fontFamilyFromSetting('consolas', fonts)).toBe(
      'Consolas, "JetBrains Mono", monospace',
    )
    expect(fontFamilyFromSetting('monospace', fonts)).toBe('monospace')
    expect(fontFamilyFromSetting('missing-font', fonts)).toBe(
      '"JetBrains Mono", Consolas, monospace',
    )
  })

  it('只为导入字体写入受控 Font Face，并在清空时移除', () => {
    const api = {
      terminalFontFileUrl: vi.fn(() => 'http://127.0.0.1/font/"custom".ttf'),
    } as unknown as TermousApi

    syncImportedFontFaces(api, fonts)

    const style = document.getElementById(importedFontStyleId)
    expect(style?.textContent).toBe(
      '@font-face{font-family:"Custom Mono";src:url("http://127.0.0.1/font/\\"custom\\".ttf") format("truetype");font-display:swap;}',
    )
    expect(api.terminalFontFileUrl).toHaveBeenCalledWith('custom-font', 'font-sha')

    syncImportedFontFaces(api, [])
    expect(document.getElementById(importedFontStyleId)).toBeNull()
  })

  it('等待导入字体加载，并将缺失能力或加载失败降级为 false', async () => {
    const load = vi.fn().mockResolvedValue([])
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    await expect(loadTerminalFont('custom-font', fonts)).resolves.toBe(true)
    expect(load).toHaveBeenCalledWith('13px "Custom Mono"')
    await expect(loadTerminalFont('jetbrains_mono', fonts)).resolves.toBe(false)

    load.mockRejectedValueOnce(new Error('字体不可用'))
    await expect(loadTerminalFont('custom-font', fonts)).resolves.toBe(false)
  })
})
