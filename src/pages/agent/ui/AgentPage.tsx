import { App as AntdApp, Alert } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentModelProfile, AgentReadiness, AgentSession } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import { AgentWorkspaceController, type AgentWorkspaceGateway } from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import { AgentWorkspace, type AgentWorkspaceInspectorState } from '#widgets/agent-workspace'
import {
  agentRunInteractionBlocked,
  latestSessionRun,
  projectAgentMessages,
  projectAgentSessions,
  selectionAfterSessionRemoval,
} from '../model/agentWorkspaceProjection.ts'
import { AgentReadinessSurface } from './AgentReadinessSurface.tsx'
import styles from './AgentPage.module.scss'

export function AgentPage({
  gateway,
  setupGateway,
  enabled,
  active,
}: {
  gateway: AgentWorkspaceGateway
  setupGateway: AgentSetupGateway
  enabled: boolean
  active: boolean
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const controller = useMemo(() => new AgentWorkspaceController({ gateway }), [gateway])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null)
  const [profiles, setProfiles] = useState<AgentModelProfile[]>([])
  const [setupLoading, setSetupLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draftModelProfileId, setDraftModelProfileId] = useState<string>()
  const busyRef = useRef(false)
  const notificationRef = useRef(notification)
  const tRef = useRef(t)
  notificationRef.current = notification
  tRef.current = t

  const acceptSetupSnapshot = useCallback((
    nextReadiness: AgentReadiness,
    nextProfiles: AgentModelProfile[],
  ) => {
    setReadiness(nextReadiness)
    setProfiles(nextProfiles)
    setDraftModelProfileId((current) => (
      current && nextProfiles.some((profile) => profile.id === current)
        ? current
        : nextReadiness.settings.default_model_profile_id || nextProfiles[0]?.id
    ))
  }, [])

  const loadSetup = useCallback(async () => {
    setSetupLoading(true)
    try {
      const [nextReadiness, nextProfiles] = await Promise.all([
        setupGateway.readiness(),
        loadProfiles(gateway),
      ])
      acceptSetupSnapshot(nextReadiness, nextProfiles)
    } catch {
      notifyError(notificationRef.current, tRef.current)
    } finally {
      setSetupLoading(false)
    }
  }, [acceptSetupSnapshot, gateway, setupGateway])

  useEffect(() => {
    if (!enabled) return
    controller.start()
    return () => controller.close()
  }, [controller, enabled])

  useEffect(() => {
    if (!enabled || !active) return
    void loadSetup()
  }, [active, enabled, loadSetup])

  const perform = useCallback(async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
      return true
    } catch {
      notifyError(notificationRef.current, tRef.current)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  if (!enabled || readiness?.status !== 'ready') {
    return (
      <div className={styles.page}>
        <AgentReadinessSurface
          readiness={readiness}
          loading={setupLoading || busy}
          onRefresh={() => void loadSetup()}
          onPrepare={() => void perform(async () => {
            const result = await setupGateway.setup()
            acceptSetupSnapshot(result, await loadProfiles(gateway))
          })}
        />
      </div>
    )
  }

  const selected = state.sessions.find((session) => session.id === state.selected_session_id)
  const selectedRun = selected ? latestSessionRun(selected.id, state.runs) : undefined
  const runEvents = selectedRun ? state.run_events[selectedRun.id] ?? [] : []
  const newSessionModelProfileId = draftModelProfileId
    ?? readiness.settings.default_model_profile_id
    ?? profiles[0]?.id
  const selectedProfile = profiles.find((profile) => (
    profile.id === (selected?.model_profile_id ?? newSessionModelProfileId)
  ))
  const contextWindow = selectedRun?.model_snapshot.context_window_tokens ?? selectedProfile?.context_window_tokens ?? 0
  const workspaceSessions = projectAgentSessions(state.sessions, profiles, state.runs)
  const inspector: AgentWorkspaceInspectorState = {
    context: {
      used_tokens: selectedRun?.usage.total_tokens ?? 0,
      context_window_tokens: contextWindow,
      estimated: selectedRun?.usage.estimated ?? true,
      warning_threshold: 0.7,
    },
    skills: [],
    mcp: {
      connected: state.runtime_status?.state !== undefined && state.runtime_status.state !== 'offline',
      scope_count: readiness.mcp_policy?.scope_count ?? 0,
      approval_bypass: readiness.mcp_policy?.approval_bypass ?? false,
    },
  }

  return (
    <div className={styles.page}>
      {state.error_code ? <Alert className={styles.alert} type="warning" showIcon title={t('agent.error.workspace')} action={<button type="button" onClick={() => void controller.reload()}>{t('app.retry')}</button>} /> : null}
      <AgentWorkspace
        sessions={workspaceSessions}
        selected_session_id={state.selected_session_id}
        messages={projectAgentMessages(selected ? state.messages[selected.id] ?? [] : [], selectedRun, runEvents)}
        models={profiles.map((profile) => ({ id: profile.id, name: profile.name, supports_reasoning: profile.supports_reasoning }))}
        selected_model_profile_id={selected?.model_profile_id ?? newSessionModelProfileId}
        inspector={inspector}
        draft={state.drafts[selected?.id ?? 'new']?.text ?? ''}
        loading={state.phase === 'loading'}
        busy={busy}
        run_blocked={agentRunInteractionBlocked(
          state.active_run_id,
          selectedRun,
          state.runtime_status,
        )}
        onCreateSession={() => {
          controller.selectSession(undefined)
          setDraftModelProfileId((current) => (
            current ?? readiness.settings.default_model_profile_id ?? profiles[0]?.id
          ))
        }}
        onSelectSession={(sessionId) => controller.selectSession(sessionId)}
        onArchiveSession={(sessionId) => void perform(async () => {
          const session = requireSession(state.sessions, sessionId)
          await controller.updateSession(sessionId, updateInput(session, true))
          if (state.selected_session_id === sessionId) {
            controller.selectSession(selectionAfterSessionRemoval(workspaceSessions, sessionId))
          }
        })}
        onDeleteSession={(sessionId) => void perform(async () => {
          const session = requireSession(state.sessions, sessionId)
          await controller.deleteSession(sessionId, session.revision)
        })}
        onModelChange={(profileId) => void perform(async () => {
          if (!selected) {
            setDraftModelProfileId(profileId)
            return
          }
          const profile = profiles.find((item) => item.id === profileId)
          await controller.updateSession(selected.id, {
            ...updateInput(selected, false),
            model_profile_id: profileId,
            reasoning_level: profile?.supports_reasoning ? selected.reasoning_level : 'off',
          })
        })}
        onDraftChange={(value) => controller.updateDraft(selected?.id ?? 'new', value)}
        onSend={async (message) => {
          await perform(async () => {
            let targetSession = selected
            if (!targetSession) {
              const profileId = newSessionModelProfileId
              if (!profileId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
              const profile = profiles.find((item) => item.id === profileId)
              targetSession = await controller.createSession({
                title: createSessionTitle(message, t('agent.sessions.untitled')),
                model_profile_id: profileId,
                reasoning_level: profile?.supports_reasoning ? readiness.settings.default_reasoning_level : 'off',
              })
              controller.updateDraft(targetSession.id, message)
              controller.updateDraft('new', '')
              setDraftModelProfileId(readiness.settings.default_model_profile_id || profiles[0]?.id)
            }
            await controller.startRun(targetSession.id, message)
          })
        }}
        onSteer={async (message) => {
          await perform(async () => {
            const targetSessionId = selected?.id
            const submittedDraft = targetSessionId
              ? controller.getSnapshot().drafts[targetSessionId]
              : undefined
            await controller.steerActiveRun(message)
            if (targetSessionId && controller.getSnapshot().drafts[targetSessionId] === submittedDraft) {
              controller.updateDraft(targetSessionId, '')
            }
          })
        }}
        onStop={async () => { await perform(() => controller.stopActiveRun()) }}
        onApprovalBypassChange={async (approvalBypass) => {
          const policy = readiness.mcp_policy
          if (!policy) throw new Error('AGENT_MCP_POLICY_MISSING')
          const updated = await perform(async () => {
            const next = await gateway.updateMcpPolicy({
              approval_bypass: approvalBypass,
              sync_scopes: false,
              expected_revision: policy.revision,
            })
            setReadiness((current) => current ? { ...current, mcp_policy: next } : current)
          })
          if (!updated) throw new Error('AGENT_MCP_POLICY_UPDATE_FAILED')
        }}
      />
    </div>
  )
}

function updateInput(session: AgentSession, archived: boolean) {
  return {
    title: session.title,
    model_profile_id: session.model_profile_id,
    reasoning_level: session.reasoning_level,
    archived,
    expected_revision: session.revision,
  }
}

function requireSession(sessions: AgentSession[], id: string) {
  const session = sessions.find((item) => item.id === id)
  if (!session) throw new Error('AGENT_SESSION_NOT_FOUND')
  return session
}

function createSessionTitle(prompt: string, fallback: string) {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || fallback
  return Array.from(firstLine).slice(0, 48).join('')
}

async function loadProfiles(gateway: AgentWorkspaceGateway) {
  const profiles: AgentModelProfile[] = []
  let cursor: string | undefined
  do {
    const page = await gateway.modelProfiles(cursor)
    profiles.push(...page.items)
    cursor = page.next_cursor
  } while (cursor && profiles.length < 256)
  return profiles
}

function notifyError(
  notification: ReturnType<typeof AntdApp.useApp>['notification'],
  t: (key: string) => string,
) {
  notification.error({
    title: t('agent.error.operation'),
    description: t('agent.error.operationDescription'),
    className: termousNotificationClassName,
  })
}
