interface PartObservation {
  visible: boolean
  height: number
  update: (visible: boolean, height: number) => void
}

// 一个会话窗口共享观察器，片段卸载时撤销登记，不积累历史 DOM 和回调。
export class AgentPartViewport {
  private readonly parts = new Map<HTMLElement, PartObservation>()
  private intersections?: IntersectionObserver
  private sizes?: ResizeObserver

  observe(node: HTMLElement, root: HTMLElement | null, update: PartObservation['update']) {
    if (typeof IntersectionObserver === 'undefined') { update(true, 48); return () => undefined }
    if (!this.intersections) {
      this.intersections = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const node = entry.target as HTMLElement
          const part = this.parts.get(node)
          if (!part || entry.isIntersecting === part.visible) continue
          // 离开视口时固定实际外框，避免详情或 Markdown 的边距在替换占位后丢失。
          if (part.visible) part.height = Math.max(1, node.getBoundingClientRect().height || part.height)
          part.visible = entry.isIntersecting
          part.update(part.visible, part.height)
        }
      }, { root, rootMargin: '600px 0px' })
      if (typeof ResizeObserver !== 'undefined') this.sizes = new ResizeObserver(entries => {
        for (const entry of entries) {
          const part = this.parts.get(entry.target as HTMLElement)
          if (part?.visible) part.height = Math.max(1, entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
        }
      })
    }
    this.parts.set(node, { visible: false, height: 48, update })
    this.intersections.observe(node)
    this.sizes?.observe(node)
    return () => {
      this.parts.delete(node)
      this.intersections?.unobserve(node)
      this.sizes?.unobserve(node)
      if (!this.parts.size) {
        this.intersections?.disconnect()
        this.sizes?.disconnect()
        this.intersections = undefined
        this.sizes = undefined
      }
    }
  }
}
