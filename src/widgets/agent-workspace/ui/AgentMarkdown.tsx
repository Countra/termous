import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import styles from './AgentMarkdown.module.scss'

export function AgentMarkdown({ children }: { children: string }) {
  const { t } = useTranslation()
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => {
            const target = safeExternalURL(href)
            if (!target) return <span>{label}</span>
            return (
              <a
                href={target}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => {
                  event.preventDefault()
                  const opening = getTermousBridge()?.external?.openUrl(target)
                  if (opening) void opening.catch(() => undefined)
                }}
              >
                {label}<ExternalLink size={11} aria-hidden="true" />
              </a>
            )
          },
          img: () => (
            <span className={styles['blocked-image']} role="img" aria-label={t('agent.markdown.remoteImageBlocked')}>
              <ImageOff size={14} />{t('agent.markdown.remoteImageBlocked')}
            </span>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

function safeExternalURL(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}
