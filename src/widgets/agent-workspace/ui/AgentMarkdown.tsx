import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, ImageOff } from 'lucide-react'
import { createContext, memo, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { isAgentToolImageReference } from '#common/contracts'
import type { AgentImageLoader } from '../model/types.ts'
import type { AgentImageCatalog } from '../model/agentImageResources.ts'
import { AgentImage } from './AgentImage.tsx'
import styles from './AgentMarkdown.module.scss'

const markdownRemarkPlugins = [remarkGfm]
type MarkdownImages = {
  images?: AgentImageCatalog
  onLoadToolImage?: AgentImageLoader
}
const MarkdownImageContext = createContext<MarkdownImages>({})

// 渲染器类型保持稳定，流式文字更新不能重新挂载图片或关闭正在查看的预览。
const markdownComponents: Components = {
  a: ({ href, children: label, node }) => {
    const target = safeExternalURL(href)
    if (!target || containsImage(node)) return <span>{label}</span>
    return (
      <a href={target} target="_blank" rel="noreferrer noopener"
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
  img: MarkdownImage,
}

function MarkdownImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const { t } = useTranslation()
  const { images, onLoadToolImage } = useContext(MarkdownImageContext)
  const reference = typeof src === 'string' && isAgentToolImageReference(src) ? src : undefined
  const image = reference ? images?.get(reference) : undefined
  if (image) return <AgentImage key={image.id} image={image} onLoad={onLoadToolImage} title={alt || t('imagePreview.title')} />
  const reason = t(reference ? 'agent.images.unavailable' : 'agent.markdown.remoteImageBlocked')
  return <span className={styles['blocked-image']} role="img" aria-label={reason}>
    <ImageOff size={14} aria-hidden="true" />{reason}
  </span>
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  images,
  onLoadToolImage,
}: { children: string } & MarkdownImages) {
  return (
    <MarkdownImageContext.Provider value={{ images, onLoadToolImage }}>
      <div className={styles.markdown}>
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          urlTransform={(url, key, node) => key === 'src' && node.tagName === 'img' && isAgentToolImageReference(url)
            ? url : defaultUrlTransform(url)}
          components={markdownComponents}
        >
          {children}
        </ReactMarkdown>
      </div>
    </MarkdownImageContext.Provider>
  )
})

type MarkdownNode = { type: string; tagName?: string; children?: readonly MarkdownNode[] }

function containsImage(node: MarkdownNode | undefined): boolean {
  return node?.tagName === 'img' || Boolean(node?.children?.some(containsImage))
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
