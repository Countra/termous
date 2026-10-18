import type { TFunction } from 'i18next'
import type { Author } from '#entities/desktop-workflow'

export function workflowAuthor(author: Author | undefined, t: TFunction): string {
  if (author?.origin !== 'mcp') return t('desktopWorkflow.origin.app')
  return author.client_source === 'builtin_agent'
    ? t('desktopWorkflow.origin.agent')
    : t('desktopWorkflow.origin.mcp', { name: author.client_name || author.client_id || 'MCP' })
}
