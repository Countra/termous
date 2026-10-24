import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AgentPartViewport } from '../model/agentPartViewport.ts'

const PartViewportContext = createContext<{ observer: AgentPartViewport; viewport: RefObject<HTMLDivElement | null> } | undefined>(undefined)

export function AgentVirtualViewport({ viewport, children }: { viewport: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const context = useMemo(() => ({ observer: new AgentPartViewport(), viewport }), [viewport])
  return <PartViewportContext.Provider value={context}>{children}</PartViewportContext.Provider>
}

// 片段离开视口后释放正文组件和图片资源，保留实测高度以维持滚动锚点。
export function AgentVirtualPart({ id, children }: { id: string; children: ReactNode }) {
  const context = useContext(PartViewportContext)
  const element = useRef<HTMLDivElement>(null)
  const height = useRef(48)
  const [visible, setVisible] = useState(!context || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const node = element.current
    if (!node || !context) return
    return context.observer.observe(node, context.viewport.current, (next, measured) => {
      height.current = measured
      setVisible(next)
    })
  }, [context])
  return <div ref={element} data-agent-part={id} style={{ display: 'flow-root', ...(!visible ? { height: height.current } : {}) }}>
    {visible ? children : null}
  </div>
}
