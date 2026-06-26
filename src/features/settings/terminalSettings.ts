import type { Settings, TerminalSettings } from '../../types/domain'

export const defaultTerminalSettings: TerminalSettings = {
  font_family: 'jetbrains_mono',
  font_size: 13,
  line_height: 1.2,
  letter_spacing: 0,
  cursor_style: 'block',
  cursor_blink: true,
  theme_mode: 'follow_app',
  scrollback: 5000,
}

const fontFamilies = new Set(['jetbrains_mono', 'consolas', 'monospace'])
const cursorStyles = new Set(['block', 'bar', 'underline'])
const themeModes = new Set(['follow_app', 'dark', 'light', 'custom'])
const scrollbacks = new Set([1000, 5000, 10000, 50000])

export function normalizeSettings(settings: Partial<Settings> | null | undefined): Settings {
  return {
    language: settings?.language === 'en-US' ? 'en-US' : 'zh-CN',
    terminal: normalizeTerminalSettings(settings?.terminal),
  }
}

export function normalizeTerminalSettings(settings: Partial<TerminalSettings> | null | undefined): TerminalSettings {
  const fontFamily = settings?.font_family
  const cursorStyle = settings?.cursor_style
  const themeMode = settings?.theme_mode
  const scrollback = settings?.scrollback
  return {
    font_family: fontFamilies.has(String(fontFamily)) ? (fontFamily as TerminalSettings['font_family']) : defaultTerminalSettings.font_family,
    font_size: Math.round(clampNumber(settings?.font_size, 12, 22, defaultTerminalSettings.font_size)),
    line_height: roundByStep(clampNumber(settings?.line_height, 1, 1.6, defaultTerminalSettings.line_height), 0.05, 2),
    letter_spacing: roundByStep(clampNumber(settings?.letter_spacing, 0, 2, defaultTerminalSettings.letter_spacing), 0.5, 1),
    cursor_style: cursorStyles.has(String(cursorStyle)) ? (cursorStyle as TerminalSettings['cursor_style']) : defaultTerminalSettings.cursor_style,
    cursor_blink: typeof settings?.cursor_blink === 'boolean' ? settings.cursor_blink : defaultTerminalSettings.cursor_blink,
    theme_mode: themeModes.has(String(themeMode)) ? (themeMode as TerminalSettings['theme_mode']) : defaultTerminalSettings.theme_mode,
    scrollback: scrollbacks.has(Number(scrollback)) ? (scrollback as TerminalSettings['scrollback']) : defaultTerminalSettings.scrollback,
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function roundByStep(value: number, step: number, precision: number) {
  return Number((Math.round(value / step) * step).toFixed(precision))
}
