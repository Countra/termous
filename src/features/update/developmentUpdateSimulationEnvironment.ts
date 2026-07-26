import type {
  UpdateWindowLanguage,
  UpdateWindowTheme,
} from '../../../electron/updateWindow'

export function readDevelopmentUpdateLanguage(): UpdateWindowLanguage {
  return typeof navigator !== 'undefined' && navigator.language.startsWith('zh')
    ? 'zh-CN'
    : 'en-US'
}

export function readDevelopmentUpdateTheme(): UpdateWindowTheme {
  return (
    typeof document !== 'undefined'
    && document.documentElement.dataset.theme === 'light'
  ) || (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: light)').matches
  )
    ? 'light'
    : 'dark'
}

export function readDevelopmentUpdatePlatform() {
  if (typeof navigator === 'undefined') {
    return 'development'
  }
  const platform = navigator.platform.toLowerCase()
  if (platform.startsWith('win')) {
    return 'win32'
  }
  if (platform.includes('mac')) {
    return 'darwin'
  }
  if (platform.includes('linux')) {
    return 'linux'
  }
  return platform || 'development'
}
