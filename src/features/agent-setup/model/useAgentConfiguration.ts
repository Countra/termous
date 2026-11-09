import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentReadiness } from '#entities/agent'
import type { AgentSetupController } from './useAgentSetupController'
import {
  agentConfigurationSettings, createAgentConfigurationDraft, rebaseAgentConfiguration,
  sameAgentConfiguration, validateAgentConfiguration, type AgentConfigurationDraft,
} from './agentConfigurationDraft'

export function useAgentConfiguration(runtime: AgentSetupController, readiness: AgentReadiness) {
  const { t } = useTranslation()
  const [{ baseline, draft, externalChange, saved }, setState] = useState(() => ({
    baseline: readiness,
    draft: createAgentConfigurationDraft(readiness.settings, readiness.mcp_policy),
    externalChange: false,
    saved: false,
  }))
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const confirmed = createAgentConfigurationDraft(baseline.settings, baseline.mcp_policy)
  const dirty = !sameAgentConfiguration(confirmed, draft)
  const errors = validateAgentConfiguration(draft, t)
  const conflict = externalChange || runtime.conflict?.kind === 'configuration'
  const busy = saving || runtime.loading || runtime.mutation !== null

  useEffect(() => {
    if (pending.current || baseline === readiness) return
    // 回读 effect 可能晚于下一次输入；基于最新状态合并，避免旧草稿覆盖新编辑。
    setState(current => {
      const old = createAgentConfigurationDraft(current.baseline.settings, current.baseline.mcp_policy)
      const latest = createAgentConfigurationDraft(readiness.settings, readiness.mcp_policy)
      const rebased = rebaseAgentConfiguration(old, current.draft, latest)
      const changed = !sameAgentConfiguration(old, latest) || current.baseline.settings.revision !== readiness.settings.revision
        || current.baseline.mcp_policy?.revision !== readiness.mcp_policy?.revision
      return { baseline: readiness, draft: rebased.draft,
        externalChange: current.externalChange || rebased.conflict, saved: current.saved && !changed }
    })
  }, [baseline, readiness, saving])

  const change = (patch: Partial<AgentConfigurationDraft>) => {
    setState(current => ({ ...current, draft: { ...current.draft, ...patch }, saved: false }))
  }
  const reset = () => {
    runtime.clearConfigurationFeedback()
    setState({ baseline: readiness, draft: createAgentConfigurationDraft(readiness.settings, readiness.mcp_policy),
      externalChange: false, saved: false })
    setFailed(false)
  }
  const refresh = async () => {
    const snapshot = await runtime.resolveConflict()
    if (!snapshot || !active.current) return
    const latest = createAgentConfigurationDraft(snapshot.readiness.settings, snapshot.readiness.mcp_policy)
    setState(current => ({ ...current, baseline: snapshot.readiness,
      draft: rebaseAgentConfiguration(confirmed, current.draft, latest).draft, externalChange: false }))
    setFailed(false)
  }
  const save = async () => {
    if (pending.current || busy || conflict || !dirty || Object.keys(errors).length) return false
    pending.current = true
    setSaving(true)
    setFailed(false)
    try {
      const settingsChanged = !sameAgentConfiguration({ ...confirmed, approvalBypass: draft.approvalBypass, hostRead: draft.hostRead, hostCapture: draft.hostCapture, hostControl: draft.hostControl, hostSecureCapture: draft.hostSecureCapture, hostSecureControl: draft.hostSecureControl }, draft)
      const hostChanged = draft.hostRead !== confirmed.hostRead || draft.hostCapture !== confirmed.hostCapture || draft.hostControl !== confirmed.hostControl || draft.hostSecureCapture !== confirmed.hostSecureCapture || draft.hostSecureControl !== confirmed.hostSecureControl
      const policyChanged = Boolean(baseline.mcp_policy && (draft.approvalBypass !== confirmed.approvalBypass || hostChanged))
      const result = await runtime.saveConfiguration(
        settingsChanged ? { ...agentConfigurationSettings(draft), expected_revision: baseline.settings.revision } : undefined,
        policyChanged ? { approval_bypass: draft.approvalBypass, sync_scopes: false, expected_revision: baseline.mcp_policy!.revision,
          ...(hostChanged ? { host_desktop: { read: draft.hostRead, capture: draft.hostCapture, control: draft.hostControl, secure_capture: draft.hostSecureCapture, secure_control: draft.hostSecureControl } } : {}),
        } : undefined,
      )
      if (!active.current) return false
      const next = { ...baseline, settings: result.settings, mcp_policy: result.policy }
      setState({ baseline: next, draft: createAgentConfigurationDraft(next.settings, next.mcp_policy),
        externalChange: false, saved: true })
      return true
    } catch {
      if (active.current) setFailed(true)
      return false
    } finally {
      pending.current = false
      if (active.current) setSaving(false)
    }
  }
  return { draft, errors, dirty, busy, saving, conflict, saved, failed, change, reset, refresh, save,
    needsBypassConfirmation: draft.approvalBypass && !confirmed.approvalBypass }
}

export type AgentConfigurationEditor = ReturnType<typeof useAgentConfiguration>
