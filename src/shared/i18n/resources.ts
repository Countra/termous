import type { AppLanguage } from '#common/contracts'
import enUSTranslation from './locales/en-US/translation.json'
import zhCNTranslation from './locales/zh-CN/translation.json'
import enUSDesktopWorkflow from './locales/en-US/desktop-workflow.json'
import zhCNDesktopWorkflow from './locales/zh-CN/desktop-workflow.json'

export const defaultNamespace = 'translation'

export const resources = {
  'zh-CN': {
    [defaultNamespace]: { ...zhCNTranslation, desktopWorkflow: zhCNDesktopWorkflow },
  },
  'en-US': {
    [defaultNamespace]: { ...enUSTranslation, desktopWorkflow: enUSDesktopWorkflow },
  },
} as const satisfies Record<AppLanguage, Record<typeof defaultNamespace, object>>

export const supportedLanguages = Object.keys(resources) as AppLanguage[]
