import type { Language } from '../types/domain'
import enUSTranslation from './locales/en-US/translation.json'
import zhCNTranslation from './locales/zh-CN/translation.json'

export const defaultNamespace = 'translation'

export const resources = {
  'zh-CN': {
    [defaultNamespace]: zhCNTranslation,
  },
  'en-US': {
    [defaultNamespace]: enUSTranslation,
  },
} as const satisfies Record<Language, Record<typeof defaultNamespace, object>>

export const supportedLanguages = Object.keys(resources) as Language[]
