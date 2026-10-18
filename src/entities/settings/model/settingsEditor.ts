import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react'

export interface SettingsEditor {
  dirty: boolean
  busy: boolean
  // 区分正在提交与测试、确认等阻塞操作；未指定时沿用 busy 的展示。
  saving?: boolean
  invalid: boolean
  ready?: boolean
  saved?: boolean
  save(): void
  reset(): void
}

export const SettingsEditorContext = createContext<((editor: SettingsEditor | null) => void) | null>(null)

// 页面只接管保存栏和离开保护；草稿与校验继续由各业务表单持有。
export function useSettingsEditor(editor: SettingsEditor) {
  const register = useContext(SettingsEditorContext)
  const current = useRef(editor)
  current.current = editor
  const state = useMemo<SettingsEditor>(() => ({
    dirty: editor.dirty,
    busy: editor.busy,
    saving: editor.saving,
    invalid: editor.invalid,
    ready: editor.ready,
    saved: editor.saved,
    save: () => current.current.save(),
    reset: () => current.current.reset(),
  }), [editor.dirty, editor.busy, editor.saving, editor.invalid, editor.ready, editor.saved])
  useLayoutEffect(() => {
    register?.(state)
    return () => register?.(null)
  }, [register, state])
  return register !== null
}
