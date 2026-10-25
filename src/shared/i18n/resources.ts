import type { AppLanguage } from '#common/contracts'
import enUSTranslation from './locales/en-US/translation.json'
import zhCNTranslation from './locales/zh-CN/translation.json'
import enUSDesktopWorkflow from './locales/en-US/desktop-workflow.json'
import zhCNDesktopWorkflow from './locales/zh-CN/desktop-workflow.json'
import enUSAnalysisWorkspace from './locales/en-US/analysis-workspace.json'
import zhCNAnalysisWorkspace from './locales/zh-CN/analysis-workspace.json'

export const defaultNamespace = 'translation'

export const resources = {
  'zh-CN': {
    [defaultNamespace]: { ...zhCNTranslation, desktopWorkflow: { ...zhCNDesktopWorkflow, analysisWorkspace: zhCNAnalysisWorkspace } },
  },
  'en-US': {
    [defaultNamespace]: { ...enUSTranslation, desktopWorkflow: { ...enUSDesktopWorkflow, analysisWorkspace: enUSAnalysisWorkspace } },
  },
} as const satisfies Record<AppLanguage, Record<typeof defaultNamespace, object>>

export const supportedLanguages = Object.keys(resources) as AppLanguage[]
