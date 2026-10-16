import { Tooltip } from 'antd'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Author } from '#entities/desktop-workflow'
import { workflowAuthor } from '../../model/author'
import styles from './WorkflowOrigin.module.scss'

export function WorkflowOrigin({ author }: { author?: Author }) {
  const { t } = useTranslation()
  if (author?.origin !== 'mcp') return null
  const label = t('desktopWorkflow.origin.createdBy', { name: workflowAuthor(author, t) })
  return <Tooltip title={label}><span className={styles['origin-icon']} role="img" aria-label={label}><Bot size={14} aria-hidden="true" /></span></Tooltip>
}
