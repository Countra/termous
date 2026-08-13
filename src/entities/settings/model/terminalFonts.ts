import type { TerminalFont, TerminalSettings } from '#common/contracts'

interface TerminalFontFileUrlProvider {
  terminalFontFileUrl: (id: string, sha256?: string) => string
}

const importedFontStyleId = 'termous-imported-terminal-fonts'
const fallbackFontFamily = '"JetBrains Mono", Consolas, monospace'

export function syncImportedFontFaces(api: TerminalFontFileUrlProvider, fonts: TerminalFont[]) {
  const css = fonts
    .filter((font) => font.kind === 'imported')
    .map((font) => {
      const family = cssString(font.family_name)
      const url = cssString(api.terminalFontFileUrl(font.id, font.sha256))
      return `@font-face{font-family:"${family}";src:url("${url}") format("truetype");font-display:swap;}`
    })
    .join('\n')
  let style = document.getElementById(importedFontStyleId) as HTMLStyleElement | null
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = importedFontStyleId
    document.head.appendChild(style)
  }
  if (style.textContent !== css) {
    style.textContent = css
  }
}

export async function loadTerminalFont(fontFamily: TerminalSettings['font_family'], fonts: TerminalFont[]) {
  const font = findTerminalFont(fontFamily, fonts)
  if (!font || font.kind !== 'imported' || !document.fonts?.load) {
    return false
  }
  try {
    await document.fonts.load(`13px "${font.family_name}"`)
    return true
  } catch {
    return false
  }
}

export function fontFamilyFromSetting(fontFamily: TerminalSettings['font_family'], fonts: TerminalFont[] = []) {
  const font = findTerminalFont(fontFamily, fonts)
  if (font?.kind === 'imported') {
    return `"${font.family_name}", ${fallbackFontFamily}`
  }
  if (fontFamily === 'consolas') {
    return 'Consolas, "JetBrains Mono", monospace'
  }
  if (fontFamily === 'monospace') {
    return 'monospace'
  }
  return fallbackFontFamily
}

export function findTerminalFont(fontFamily: TerminalSettings['font_family'], fonts: TerminalFont[]) {
  return fonts.find((font) => font.id === fontFamily)
}

function cssString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
