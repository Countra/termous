import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from 'react'
import type { AuditQuery } from '#entities/audit'

const filterKeys = ['search', 'search_field', 'source', 'type', 'outcome', 'level', 'from', 'until', 'scope', 'action', 'correlation_id'] as const
export type AuditFilterValues = Pick<AuditQuery, typeof filterKeys[number]>
type TextFilter = 'search' | 'action' | 'correlation_id'

function normalizeFilters(draft: AuditFilterValues): AuditFilterValues {
  const values: Record<string, string> = {}
  for (const key of filterKeys) {
    const value = draft[key]?.trim()
    if (value && !(key === 'search_field' && (value === 'all' || !draft.search?.trim()))) values[key] = value
  }
  return values
}

// 所有文本条件共用一次防抖提交；下拉、清空和回车会合并当前草稿，避免先查询旧关键词。
export function useAuditFilters(onChange: (values: AuditFilterValues) => void) {
  const [draft, setDraft] = useState<AuditFilterValues>({})
  const [composing, setComposing] = useState(false)
  const [revision, setRevision] = useState(0)
  const immediate = useRef(false)
  const applied = useRef<string | null>('{}')

  useEffect(() => {
    if (composing) return
    const values = normalizeFilters(draft)
    const signature = JSON.stringify(values)
    if (signature === applied.current) return
    const publish = () => { applied.current = signature; onChange(values) }
    if (immediate.current) { publish(); return }
    const timer = setTimeout(publish, 300)
    return () => clearTimeout(timer)
  }, [draft, composing, revision, onChange])

  const change = <K extends keyof AuditFilterValues>(key: K, value: AuditFilterValues[K], now = true) => {
    immediate.current = now
    setDraft((current) => ({ ...current, [key]: value || undefined }))
  }
  const textInput = (key: TextFilter) => ({
    value: draft[key] ?? '',
    onChange: (event: ChangeEvent<HTMLInputElement>) => change(key, event.target.value, !event.target.value.trim()),
    onCompositionStart: () => { immediate.current = false; setComposing(true) },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => { change(key, event.currentTarget.value, false); setComposing(false) },
    onPressEnter: (event: KeyboardEvent<HTMLInputElement>) => {
      if (!event.nativeEvent.isComposing && !composing) { immediate.current = true; setRevision((value) => value + 1) }
    },
  })
  const reset = () => {
    immediate.current = true
    // 即使只有尚未提交的草稿，重置也应通知列表回到默认第一页。
    applied.current = null
    setComposing(false)
    setDraft({})
  }

  return { draft, change, textInput, reset, hasFilters: Object.entries(draft).some(([key, value]) => Boolean(value) && !(key === 'search_field' && value === 'all')) }
}
