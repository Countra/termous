import type { AppLanguage } from '#common/contracts'
import enUSTranslation from './locales/en-US/translation.json'
import zhCNTranslation from './locales/zh-CN/translation.json'
import enUSDesktopWorkflow from './locales/en-US/desktop-workflow.json'
import zhCNDesktopWorkflow from './locales/zh-CN/desktop-workflow.json'
import enUSAnalysisWorkspace from './locales/en-US/analysis-workspace.json'
import zhCNAnalysisWorkspace from './locales/zh-CN/analysis-workspace.json'
import enUSExtensions from './locales/en-US/extensions.json'
import zhCNExtensions from './locales/zh-CN/extensions.json'
import enUSLocalTools from './locales/en-US/local-tools.json'
import zhCNLocalTools from './locales/zh-CN/local-tools.json'
import zhCNPreparation from './locales/zh-CN/mcp-preparation.json'
import enUSPreparation from './locales/en-US/mcp-preparation.json'
import zhCNFileReview from './locales/zh-CN/file-review.json'
import enUSFileReview from './locales/en-US/file-review.json'

export const defaultNamespace = 'translation'

export const resources = {
  'zh-CN': {
    [defaultNamespace]: { ...zhCNTranslation, fileReview: zhCNFileReview, localTools: zhCNLocalTools, mcpPreparation: zhCNPreparation, extensions: zhCNExtensions, settings: { ...zhCNTranslation.settings, tabMcp: 'MCP 服务', descriptions: { ...zhCNTranslation.settings.descriptions, extensions: zhCNExtensions.description } }, desktopWorkflow: { ...zhCNDesktopWorkflow, analysisWorkspace: zhCNAnalysisWorkspace } },
  },
  'en-US': {
    [defaultNamespace]: { ...enUSTranslation, fileReview: enUSFileReview, localTools: enUSLocalTools, mcpPreparation: enUSPreparation, extensions: enUSExtensions, settings: { ...enUSTranslation.settings, tabMcp: 'MCP server', descriptions: { ...enUSTranslation.settings.descriptions, extensions: enUSExtensions.description } }, desktopWorkflow: { ...enUSDesktopWorkflow, analysisWorkspace: enUSAnalysisWorkspace } },
  },
} as const satisfies Record<AppLanguage, Record<typeof defaultNamespace, object>>

export const supportedLanguages = Object.keys(resources) as AppLanguage[]
