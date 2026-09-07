import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react'
import type { AgentWorkspaceModelOption } from '../model/types.ts'
import styles from './AgentResponseOptionsMenu.module.scss'

const groupRowHeight = 25
const modelRowHeight = 34
const defaultViewportHeight = 326
const overscanPixels = modelRowHeight * 2

export interface AgentModelGroup {
  key: string
  label: string
  models: AgentWorkspaceModelOption[]
}

type ModelListEntry = {
  key: string
  top: number
  height: number
} & ({
  kind: 'group'
  label: string
} | {
  kind: 'model'
  model: AgentWorkspaceModelOption
  position: number
})

export function AgentVirtualModelList({
  groups,
  selectedModelId,
  resetToStart,
  onScroll,
  renderModel,
}: {
  groups: AgentModelGroup[]
  selectedModelId?: string
  resetToStart: boolean
  onScroll: () => void
  renderModel: (
    model: AgentWorkspaceModelOption,
    position: number,
    total: number,
  ) => ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(defaultViewportHeight)
  const layout = useMemo(() => buildLayout(groups), [groups])
  const visibleEntries = useMemo(
    () => readVisibleEntries(layout.entries, scrollTop, viewportHeight),
    [layout.entries, scrollTop, viewportHeight],
  )

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => {
      const nextHeight = element.clientHeight
      if (nextHeight > 0) setViewportHeight(nextHeight)
    }
    measure()
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const visibleHeight = element.clientHeight || viewportHeight
    const selectedEntry = resetToStart
      ? undefined
      : layout.entries.find((entry) => (
        entry.kind === 'model' && entry.model.id === selectedModelId
      ))
    const requestedTop = selectedEntry
      ? selectedEntry.top - ((visibleHeight - selectedEntry.height) / 2)
      : 0
    const nextTop = Math.max(0, Math.min(
      requestedTop,
      Math.max(0, layout.totalHeight - visibleHeight),
    ))
    element.scrollTop = nextTop
    setScrollTop(nextTop)
  }, [layout, resetToStart, selectedModelId, viewportHeight])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
    onScroll()
  }

  return (
    <div
      ref={scrollRef}
      className={styles['model-scroll']}
      data-virtual-model-list
      onScroll={handleScroll}
    >
      <div
        className={styles['model-virtual-content']}
        style={{ height: layout.totalHeight }}
      >
        {visibleEntries.map((entry) => (
          <div
            key={entry.key}
            className={styles['model-virtual-entry']}
            data-kind={entry.kind}
            style={{ height: entry.height, transform: `translateY(${entry.top}px)` }}
          >
            {entry.kind === 'group'
              ? <div className={styles['group-label']}>{entry.label}</div>
              : renderModel(entry.model, entry.position, layout.modelCount)}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildLayout(groups: AgentModelGroup[]) {
  const entries: ModelListEntry[] = []
  let top = 0
  let position = 0
  for (const group of groups) {
    entries.push({
      kind: 'group',
      key: `group:${group.key}`,
      label: group.label,
      top,
      height: groupRowHeight,
    })
    top += groupRowHeight
    for (const model of group.models) {
      position += 1
      entries.push({
        kind: 'model',
        key: `model:${model.id}`,
        model,
        position,
        top,
        height: modelRowHeight,
      })
      top += modelRowHeight
    }
  }
  return { entries, totalHeight: top, modelCount: position }
}

function readVisibleEntries(
  entries: ModelListEntry[],
  scrollTop: number,
  viewportHeight: number,
) {
  const start = Math.max(0, scrollTop - overscanPixels)
  const end = scrollTop + viewportHeight + overscanPixels
  let first = 0
  while (first < entries.length && entries[first].top + entries[first].height < start) {
    first += 1
  }
  let last = first
  while (last < entries.length && entries[last].top <= end) {
    last += 1
  }
  return entries.slice(first, last)
}
