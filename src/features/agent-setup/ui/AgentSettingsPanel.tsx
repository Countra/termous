import { useEffect, useMemo, useState } from 'react'
import { Alert, App as AntdApp, Button, Select, Skeleton, Switch, Tag, Tooltip } from 'antd'
import {
  BrainCircuit, Check, CircleAlert, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModelProfile, AgentReadinessComponent, AgentReasoningLevel } from '#entities/agent'
import { ConfirmDialog, termousNotificationClassName, uiStyles } from '#shared/ui'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { useAgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentApiKeyDialog } from './AgentApiKeyDialog.tsx'
import { AgentModelProfileEditor } from './AgentModelProfileEditor.tsx'
import styles from './AgentSetup.module.scss'

export function AgentSettingsPanel({ gateway }: { gateway: AgentSetupGateway }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useAgentSetupController(gateway)
  const [editor, setEditor] = useState<{ profile?: AgentModelProfile } | null>(null)
  const [editorRevisionRefreshed, setEditorRevisionRefreshed] = useState(false)
  const [keyProfileId, setKeyProfileId] = useState<string | null>(null)
  const [keyRevisionRefreshed, setKeyRevisionRefreshed] = useState(false)
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)
  const [removeKeyProfileId, setRemoveKeyProfileId] = useState<string | null>(null)
  const [testProfileId, setTestProfileId] = useState<string | null>(null)
  const [confirmBypass, setConfirmBypass] = useState(false)
  const profileById = useMemo(() => new Map(runtime.profiles.map((profile) => [profile.id, profile])), [runtime.profiles])
  const keyProfile = keyProfileId ? profileById.get(keyProfileId) : undefined
  const deleteProfile = deleteProfileId ? profileById.get(deleteProfileId) : undefined
  const removeKeyProfile = removeKeyProfileId ? profileById.get(removeKeyProfileId) : undefined
  const testProfile = testProfileId ? profileById.get(testProfileId) : undefined
  const editorProfile = editor?.profile ? profileById.get(editor.profile.id) ?? editor.profile : undefined
  const defaultProfile = readinessProfile(runtime.readiness?.settings.default_model_profile_id, profileById)

  useEffect(() => {
    if (keyProfileId && !keyProfile) setKeyProfileId(null)
    if (deleteProfileId && !deleteProfile) setDeleteProfileId(null)
    if (removeKeyProfileId && !removeKeyProfile) setRemoveKeyProfileId(null)
    if (testProfileId && !testProfile) setTestProfileId(null)
  }, [deleteProfile, deleteProfileId, keyProfile, keyProfileId, removeKeyProfile, removeKeyProfileId, testProfile, testProfileId])

  useEffect(() => {
    const conflict = runtime.conflict
    if (!conflict || conflict.kind !== 'profile') return
    if (conflict.operation === 'delete') setDeleteProfileId(null)
    if (conflict.operation === 'test') setTestProfileId(null)
    if (conflict.operation === 'api_key' && removeKeyProfileId === conflict.profileId) setRemoveKeyProfileId(null)
  }, [removeKeyProfileId, runtime.conflict])

  if (runtime.loading && !runtime.readiness) {
    return <div className={styles.skeleton}><Skeleton active paragraph={{ rows: 8 }} /></div>
  }

  if (!runtime.readiness) {
    return (
      <section className={styles.surface}>
        <Alert type="error" showIcon title={t('settings.agent.loadFailed')} description={publicError(t, runtime.error)} />
        <Button icon={<RefreshCw size={15} />} loading={runtime.loading} onClick={() => consume(runtime.load())}>{t('app.retry')}</Button>
      </section>
    )
  }

  const { readiness } = runtime
  const busy = runtime.loading || runtime.mutation !== null
  const saveProfile = async (input: Parameters<typeof runtime.saveProfile>[0]) => {
    await runtime.saveProfile(input, editorProfile)
    setEditor(null)
  }
  const resolveConflict = async () => {
    const conflict = runtime.conflict
    const snapshot = await runtime.resolveConflict()
    if (!snapshot || !conflict || conflict.kind !== 'profile') return
    if (conflict.operation === 'edit' && editor?.profile?.id === conflict.profileId) setEditorRevisionRefreshed(true)
    if (conflict.operation === 'api_key' && keyProfileId === conflict.profileId) setKeyRevisionRefreshed(true)
  }
  const conflictAction = <Button size="small" loading={runtime.loading} onClick={() => void resolveConflict()}>{t('settings.agent.conflict.refresh')}</Button>

  return (
    <div className={styles.stack}>
      {runtime.conflict ? <Alert type="warning" showIcon title={t('settings.agent.conflict.title')} description={t('settings.agent.conflict.description')} action={conflictAction} />
        : runtime.error ? <Alert type="error" showIcon closable title={t('settings.agent.operationFailed')} description={publicError(t, runtime.error)} /> : null}

      <section className={styles.surface}>
        <header className={styles['section-header']}>
          <div className={styles['section-title']}><BrainCircuit size={18} aria-hidden="true" /><h2>{t('settings.agent.readiness.title')}</h2></div>
          <Button
            type={readiness.status === 'ready' ? 'default' : 'primary'}
            icon={readiness.status === 'ready' ? <RefreshCw size={15} /> : <Wrench size={15} />}
            loading={runtime.mutation === 'setup'}
            disabled={busy && runtime.mutation !== 'setup'}
            onClick={() => consume(runtime.setup())}
          >
            {t(readiness.status === 'ready' ? 'settings.agent.readiness.checkAgain' : 'settings.agent.readiness.setup')}
          </Button>
        </header>
        <p className={styles['section-hint']}>{t('settings.agent.readiness.description')}</p>
        <div className={styles['readiness-list']}>
          <ReadinessRow label={t('settings.agent.readiness.mcpRuntime')} component={readiness.mcp_runtime} />
          <ReadinessRow label={t('settings.agent.readiness.mcpClient')} component={readiness.mcp_client} />
          <ReadinessRow label={t('settings.agent.readiness.skills')} component={readiness.skills_bundle} />
          <ReadinessRow label={t('settings.agent.readiness.defaultModel')} component={readiness.default_model} />
        </div>
      </section>

      <section className={styles.surface}>
        <header className={styles['section-header']}>
          <div>
            <div className={styles['section-title']}><ShieldCheck size={18} aria-hidden="true" /><h2>{t('settings.agent.policy.title')}</h2></div>
            <p className={styles['section-hint']}>{t('settings.agent.policy.description')}</p>
          </div>
        </header>
        {readiness.mcp_policy ? (
          <div className={styles['policy-row']}>
            <div>
              <strong>{t('settings.agent.policy.approval')}</strong>
              <span>{t(readiness.mcp_policy.approval_bypass ? 'settings.agent.policy.bypassHint' : 'settings.agent.policy.reviewHint')}</span>
            </div>
            <Switch
              checked={readiness.mcp_policy.approval_bypass}
              checkedChildren={t('settings.agent.policy.bypass')}
              unCheckedChildren={t('settings.agent.policy.review')}
              loading={runtime.mutation === 'policy'}
              disabled={busy}
              onChange={(checked) => checked ? setConfirmBypass(true) : consume(runtime.updatePolicy(false))}
            />
          </div>
        ) : <p className={styles.empty}>{t('settings.agent.policy.unavailable')}</p>}
        {readiness.mcp_policy?.scope_sync_required ? (
          <div className={styles['scope-sync']}>
            <div><CircleAlert size={16} /><span>{t('settings.agent.policy.scopeOutdated', { current: readiness.mcp_policy.scope_count, required: readiness.mcp_policy.required_scope_count })}</span></div>
            <Button size="small" disabled={busy} loading={runtime.mutation === 'policy'} onClick={() => consume(runtime.updatePolicy(readiness.mcp_policy?.approval_bypass ?? false, true))}>{t('settings.agent.policy.sync')}</Button>
          </div>
        ) : null}
      </section>

      <section className={styles.surface}>
        <header className={styles['section-header']}>
          <div>
            <div className={styles['section-title']}><BrainCircuit size={18} aria-hidden="true" /><h2>{t('settings.agent.models.title')}</h2></div>
            <p className={styles['section-hint']}>{t('settings.agent.models.description')}</p>
          </div>
          <Button type="primary" icon={<Plus size={15} />} disabled={busy} onClick={() => { setEditorRevisionRefreshed(false); setEditor({}) }}>{t('settings.agent.models.add')}</Button>
        </header>
        <div className={styles['model-list']}>
          {runtime.profiles.length === 0 ? <p className={styles.empty}>{t('settings.agent.models.empty')}</p> : runtime.profiles.map((profile) => (
            <ModelRow
              key={profile.id}
              profile={profile}
              isDefault={readiness.settings.default_model_profile_id === profile.id}
              disabled={busy}
              onEdit={() => { setEditorRevisionRefreshed(false); setEditor({ profile }) }}
              onKey={() => { setKeyRevisionRefreshed(false); setKeyProfileId(profile.id) }}
              onRemoveKey={() => setRemoveKeyProfileId(profile.id)}
              onTest={() => setTestProfileId(profile.id)}
              onDelete={() => setDeleteProfileId(profile.id)}
            />
          ))}
        </div>
      </section>

      <section className={styles.surface}>
        <header className={styles['section-header']}><div className={styles['section-title']}><BrainCircuit size={18} /><h2>{t('settings.agent.defaults.title')}</h2></div></header>
        <div className={styles['defaults-grid']}>
          <label><span>{t('settings.agent.defaults.model')}</span><Select
            value={readiness.settings.default_model_profile_id || undefined}
            placeholder={t('settings.agent.defaults.modelPlaceholder')}
            allowClear
            disabled={busy}
            options={runtime.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            onChange={(value) => {
              const selected = value ? profileById.get(value) : undefined
              const reasoning = selected && !selected.supports_reasoning ? 'off' : readiness.settings.default_reasoning_level
              consume(runtime.updateSettings(value ?? '', reasoning))
            }}
          /></label>
          <label><span>{t('settings.agent.defaults.reasoning')}</span><Select
            value={readiness.settings.default_reasoning_level}
            disabled={busy}
            options={(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as AgentReasoningLevel[]).map((value) => ({
              value,
              label: t(`settings.agent.reasoning.${value}`),
              disabled: value !== 'off' && Boolean(defaultProfile && !defaultProfile.supports_reasoning),
            }))}
            onChange={(value) => consume(runtime.updateSettings(readiness.settings.default_model_profile_id ?? '', value))}
          /></label>
        </div>
      </section>

      <AgentModelProfileEditor
        open={Boolean(editor)}
        profile={editorProfile}
        busy={runtime.loading || Boolean(runtime.mutation?.startsWith('model:'))}
        conflicted={runtime.conflict?.kind === 'profile' && runtime.conflict.operation === 'edit' && runtime.conflict.profileId === editorProfile?.id}
        revisionRefreshed={editorRevisionRefreshed}
        onCancel={() => setEditor(null)}
        onResolveConflict={resolveConflict}
        onSave={saveProfile}
      />
      <AgentApiKeyDialog
        profile={keyProfile}
        busy={runtime.loading || runtime.mutation === `model:${keyProfile?.id}`}
        conflicted={runtime.conflict?.kind === 'profile' && runtime.conflict.operation === 'api_key' && runtime.conflict.profileId === keyProfile?.id}
        revisionRefreshed={keyRevisionRefreshed}
        onCancel={() => setKeyProfileId(null)}
        onResolveConflict={resolveConflict}
        onSave={async (apiKey) => { if (!keyProfile) return; await runtime.replaceApiKey(keyProfile, apiKey); setKeyProfileId(null) }}
      />
      <ConfirmDialog open={confirmBypass} title={t('settings.agent.confirmBypass.title')} description={t('settings.agent.confirmBypass.description')} confirmLabel={t('settings.agent.confirmBypass.confirm')} danger confirmLoading={runtime.mutation === 'policy'} onCancel={() => setConfirmBypass(false)} onConfirm={() => consume(runtime.updatePolicy(true).then(() => setConfirmBypass(false)))} />
      <ConfirmDialog open={Boolean(testProfile)} title={t('settings.agent.confirmTest.title')} description={t('settings.agent.confirmTest.description')} confirmLabel={t('settings.agent.confirmTest.confirm')} confirmLoading={runtime.mutation === `model:${testProfile?.id}`} onCancel={() => setTestProfileId(null)} onConfirm={() => { if (!testProfile) return; consume(runtime.testProfile(testProfile).then((result) => { setTestProfileId(null); notification[result.status === 'ready' ? 'success' : 'warning']({ title: t(result.status === 'ready' ? 'settings.agent.testSuccess' : 'settings.agent.testFailed', { latency: result.latency_ms }), description: t(result.status === 'ready' ? 'settings.agent.testResult.ready' : 'settings.agent.testResult.failed'), className: termousNotificationClassName }) })) }} />
      <ConfirmDialog open={Boolean(deleteProfile)} title={t('settings.agent.confirmDelete.title')} description={t('settings.agent.confirmDelete.description', { name: deleteProfile?.name })} confirmLabel={t('app.delete')} danger confirmLoading={runtime.mutation === `model:${deleteProfile?.id}`} onCancel={() => setDeleteProfileId(null)} onConfirm={() => { if (!deleteProfile) return; consume(runtime.deleteProfile(deleteProfile).then(() => setDeleteProfileId(null))) }} />
      <ConfirmDialog open={Boolean(removeKeyProfile)} title={t('settings.agent.confirmRemoveKey.title')} description={t('settings.agent.confirmRemoveKey.description')} confirmLabel={t('settings.agent.confirmRemoveKey.confirm')} danger confirmLoading={runtime.mutation === `model:${removeKeyProfile?.id}`} onCancel={() => setRemoveKeyProfileId(null)} onConfirm={() => { if (!removeKeyProfile) return; consume(runtime.deleteApiKey(removeKeyProfile).then(() => setRemoveKeyProfileId(null))) }} />
    </div>
  )
}

function ReadinessRow({ label, component }: { label: string; component: AgentReadinessComponent }) {
  const { t } = useTranslation()
  return <div className={styles['readiness-row']}><span className={`${styles['readiness-icon']} ${styles[`is-${component.status}`]}`}>{component.status === 'ready' ? <Check size={14} /> : <CircleAlert size={14} />}</span><strong>{label}</strong><span className={styles['readiness-message']}>{t(`settings.agent.componentMessage.${component.status}`)}</span><Tag color={component.status === 'ready' ? 'success' : component.status === 'unavailable' ? 'error' : 'warning'}>{t(`settings.agent.componentState.${component.status}`)}</Tag></div>
}

function ModelRow({ profile, isDefault, disabled, onEdit, onKey, onRemoveKey, onTest, onDelete }: { profile: AgentModelProfile; isDefault: boolean; disabled: boolean; onEdit: () => void; onKey: () => void; onRemoveKey: () => void; onTest: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  return <article className={styles['model-row']}><div className={styles['model-main']}><span className={styles['model-icon']}><BrainCircuit size={16} /></span><div><div className={styles['model-name']}><strong>{profile.name}</strong>{isDefault ? <Tag color="processing">{t('settings.agent.models.default')}</Tag> : null}{isInsecureHttp(profile.base_url) ? <Tag color="warning">{t('settings.agent.models.insecureHttp')}</Tag> : null}</div><span>{profile.model_id} · {t(`settings.agent.apiMode.${profile.api_mode === 'responses' ? 'responses' : 'chatCompletions'}`)}</span></div></div><div className={styles['model-actions']}><Tag icon={<KeyRound size={12} />} color={profile.api_key_configured ? 'success' : 'default'}>{t(profile.api_key_configured ? 'settings.agent.apiKey.configured' : 'settings.agent.apiKey.notConfigured')}</Tag><Action title={t('settings.agent.models.test')} icon={<RefreshCw size={15} />} disabled={disabled} onClick={onTest} /><Action title={t('settings.agent.apiKey.title')} icon={<KeyRound size={15} />} disabled={disabled} onClick={onKey} />{profile.api_key_configured ? <Action title={t('settings.agent.apiKey.remove')} icon={<Trash2 size={15} />} disabled={disabled} danger onClick={onRemoveKey} /> : null}<Action title={t('app.edit')} icon={<Pencil size={15} />} disabled={disabled} onClick={onEdit} /><Action title={t('app.delete')} icon={<Trash2 size={15} />} disabled={disabled || isDefault} danger onClick={onDelete} /></div></article>
}

function Action({ title, icon, disabled, danger = false, onClick }: { title: string; icon: React.ReactNode; disabled: boolean; danger?: boolean; onClick: () => void }) {
  return <Tooltip title={title} classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}><Button type="text" icon={icon} danger={danger} disabled={disabled} aria-label={title} onClick={onClick} /></Tooltip>
}

function publicError(t: (key: string) => string, error: Error | null) {
  if (!error) return t('settings.agent.error.generic')
  if ('status' in error && error.status === 409) return t('settings.agent.error.conflict')
  if ('code' in error && error.code === 'VAULT_LOCKED') return t('settings.agent.error.vaultLocked')
  return t('settings.agent.error.generic')
}

function isInsecureHttp(value: string) {
  try { return new URL(value).protocol === 'http:' } catch { return false }
}

function readinessProfile(id: string | undefined, profiles: Map<string, AgentModelProfile>) {
  return id ? profiles.get(id) : undefined
}

function consume(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}
