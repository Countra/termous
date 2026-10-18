import { useState } from 'react'
import { isAgentModelRunnable } from '#entities/agent'
import type { SettingsEditor } from '#entities/settings'
import type { AgentSetupController } from './useAgentSetupController.ts'

// 目录中的默认模型也先进入草稿，避免与页面底部的统一保存产生两套提交行为。
export function useAgentDefaultModelDraft(runtime: AgentSetupController) {
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<{ baseline?: string; value: string }>()
  const actual = runtime.readiness?.settings.default_model_id
  const dirty = Boolean(draft && draft.value !== actual)
  const conflicted = dirty && (draft?.baseline !== actual || runtime.conflict?.kind === 'settings')
  const reset = () => setDraft(undefined)
  const editor: SettingsEditor = {
    dirty, busy: saving || runtime.loading || runtime.mutation !== null, saving, invalid: conflicted,
    save: () => {
      if (!dirty || !draft || conflicted || runtime.loading || runtime.mutation) return
      const model = runtime.models.find(model => model.id === draft.value)
      const provider = runtime.providers.find(provider => provider.id === model?.provider_id)
      if (!model || !provider || !isAgentModelRunnable(model, provider)) return
      setSaving(true)
      void runtime.updateSettings({ default_model_id: draft.value }).then(reset).catch(() => undefined).finally(() => setSaving(false))
    },
    reset,
  }
  const selected = draft && runtime.models.find(model => model.id === draft.value)
  const provider = selected && runtime.providers.find(provider => provider.id === selected.provider_id)
  const unavailable = Boolean(dirty && (!selected || !provider || !isAgentModelRunnable(selected, provider)))
  editor.invalid ||= unavailable
  return {
    editor, conflicted, unavailable, pendingId: dirty ? draft?.value : undefined,
    select: (value: string) => setDraft(current => ({ baseline: current && current.value !== actual ? current.baseline : actual, value })),
    reset,
    refresh: async () => {
      const snapshot = await runtime.resolveConflict()
      if (snapshot) setDraft(current => current && ({ ...current, baseline: snapshot.readiness.settings.default_model_id }))
    },
  }
}
