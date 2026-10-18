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
  const [baseline, setBaseline] = useState(() => readiness)
  const [draft, setDraft] = useState(() => createAgentConfigurationDraft(readiness.settings, readiness.mcp_policy))
  const [externalChange, setExternalChange] = useState(false)
  const [saved, setSaved] = useState(false)
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
    const old = createAgentConfigurationDraft(baseline.settings, baseline.mcp_policy)
    const latest = createAgentConfigurationDraft(readiness.settings, readiness.mcp_policy)
    const rebased = rebaseAgentConfiguration(old, draft, latest)
    setBaseline(readiness)
    setDraft(rebased.draft)
    setExternalChange(previous => previous || rebased.conflict)
    if (!sameAgentConfiguration(old, latest) || baseline.settings.revision !== readiness.settings.revision
      || baseline.mcp_policy?.revision !== readiness.mcp_policy?.revision) setSaved(false)
  }, [baseline, draft, readiness, saving])

  const change = (patch: Partial<AgentConfigurationDraft>) => {
    setDraft(current => ({ ...current, ...patch }))
    setSaved(false)
  }
  const reset = () => {
    runtime.clearConfigurationFeedback()
    setBaseline(readiness)
    setDraft(createAgentConfigurationDraft(readiness.settings, readiness.mcp_policy))
    setExternalChange(false)
    setSaved(false)
    setFailed(false)
  }
  const refresh = async () => {
    const snapshot = await runtime.resolveConflict()
    if (!snapshot || !active.current) return
    const latest = createAgentConfigurationDraft(snapshot.readiness.settings, snapshot.readiness.mcp_policy)
    const rebased = rebaseAgentConfiguration(confirmed, draft, latest)
    setBaseline(snapshot.readiness)
    setDraft(rebased.draft)
    setExternalChange(false)
    setFailed(false)
  }
  const save = async () => {
    if (pending.current || busy || conflict || !dirty || Object.keys(errors).length) return false
    pending.current = true
    setSaving(true)
    setFailed(false)
    try {
      const settingsChanged = !sameAgentConfiguration({ ...confirmed, approvalBypass: draft.approvalBypass }, draft)
      const policyChanged = Boolean(baseline.mcp_policy && draft.approvalBypass !== confirmed.approvalBypass)
      const result = await runtime.saveConfiguration(
        settingsChanged ? { ...agentConfigurationSettings(draft), expected_revision: baseline.settings.revision } : undefined,
        policyChanged ? { approval_bypass: draft.approvalBypass, sync_scopes: false, expected_revision: baseline.mcp_policy!.revision } : undefined,
      )
      if (!active.current) return false
      const next = { ...baseline, settings: result.settings, mcp_policy: result.policy }
      setBaseline(next)
      setDraft(createAgentConfigurationDraft(next.settings, next.mcp_policy))
      setExternalChange(false)
      setSaved(true)
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
