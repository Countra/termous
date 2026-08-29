import { useMemo, useState } from 'react'
import { Alert, Button, Select, Switch } from 'antd'
import {
  BrainCircuit,
  Check,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  isAgentModelRunnable,
  type AgentModel,
  type AgentModelProvider,
  type AgentReadinessComponent,
  type AgentReasoningLevel,
} from '#entities/agent'
import { ConfirmDialog, customSelectStyles } from '#shared/ui'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'
import styles from './AgentSetup.module.scss'

export function AgentRuntimeSettings({ runtime }: { runtime: AgentSetupController }) {
  const { t } = useTranslation()
  const [confirmBypass, setConfirmBypass] = useState(false)
  const providerById = useMemo(
    () => new Map(runtime.providers.map((provider) => [provider.id, provider])),
    [runtime.providers],
  )
  const modelById = useMemo(
    () => new Map(runtime.models.map((model) => [model.id, model])),
    [runtime.models],
  )
  const modelOptions = useMemo(
    () => buildModelOptions(runtime.providers, runtime.models),
    [runtime.models, runtime.providers],
  )
  const readiness = runtime.readiness
  if (!readiness) return null

  const busy = runtime.loading || runtime.mutation !== null
  const defaultModel = readiness.settings.default_model_id
    ? modelById.get(readiness.settings.default_model_id)
    : undefined
  const readinessState = readiness.status === 'ready'
    ? 'ready'
    : readiness.status === 'blocked'
      ? 'unavailable'
      : readiness.status === 'needs_repair'
        ? 'outdated'
        : 'missing'

  return (
    <>
      <section className={`${styles.surface} ${styles['runtime-surface']}`}>
        <header className={`${styles['section-header']} ${styles['runtime-header']}`}>
          <div className={styles['runtime-heading']}>
            <span className={styles['runtime-icon']} aria-hidden="true">
              <BrainCircuit size={18} />
            </span>
            <div>
              <div className={styles['section-title']}>
                <h2>{t('settings.agent.readiness.title')}</h2>
              </div>
              <p className={styles['section-hint']}>{t('settings.agent.readiness.description')}</p>
            </div>
          </div>
          <div className={styles['runtime-controls']}>
            <span
              className={`${styles['runtime-status']} ${styles[`is-${readinessState}`]}`}
              role="status"
            >
              <i aria-hidden="true" />
              {t(`settings.agent.componentState.${readinessState}`)}
            </span>
            <Button
              type={readiness.status === 'ready' ? 'default' : 'primary'}
              icon={readiness.status === 'ready' ? <RefreshCw size={15} /> : <Wrench size={15} />}
              loading={runtime.mutation === 'setup'}
              disabled={busy && runtime.mutation !== 'setup'}
              onClick={() => consume(runtime.setup())}
            >
              {t(readiness.status === 'ready'
                ? 'settings.agent.readiness.checkAgain'
                : 'settings.agent.readiness.setup')}
            </Button>
          </div>
        </header>

        <div className={styles['readiness-grid']}>
          <ReadinessItem label={t('settings.agent.readiness.mcpRuntime')} component={readiness.mcp_runtime} />
          <ReadinessItem label={t('settings.agent.readiness.mcpClient')} component={readiness.mcp_client} />
          <ReadinessItem label={t('settings.agent.readiness.skills')} component={readiness.skills_bundle} />
          <ReadinessItem label={t('settings.agent.readiness.defaultModel')} component={readiness.default_model} />
        </div>

        <div className={styles['agent-setting-list']}>
          <section className={styles['agent-setting-row']} aria-labelledby="agent-defaults-title">
            <span className={styles['agent-setting-icon']} aria-hidden="true">
              <SlidersHorizontal size={16} />
            </span>
            <div className={styles['agent-setting-copy']}>
              <strong id="agent-defaults-title">{t('settings.agent.defaults.title')}</strong>
              <span>{t('settings.agent.defaults.description')}</span>
            </div>
            <div className={styles['default-controls']}>
              <label className={styles['agent-control-field']}>
                <span>{t('settings.agent.defaults.model')}</span>
                <Select
                  value={readiness.settings.default_model_id || undefined}
                  placeholder={t('settings.agent.defaults.modelPlaceholder')}
                  allowClear
                  showSearch
                  disabled={busy}
                  aria-label={t('settings.agent.defaults.model')}
                  className={customSelectStyles.select}
                  classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                  options={modelOptions}
                  filterOption={(input, option) => (
                    isAgentModelSelectOption(option)
                      ? option.search_text.includes(input.trim().toLocaleLowerCase())
                      : false
                  )}
                  optionLabelProp="label"
                  labelRender={({ value, label }) => modelById.get(String(value))?.display_name ?? label}
                  optionRender={(option) => {
                    const modelOption = option.data
                    if (!isAgentModelSelectOption(modelOption)) return option.label
                    return (
                      <span className={styles['model-option']}>
                        <strong>{modelOption.label}</strong>
                        <small>{modelOption.provider_name} · {modelOption.remote_model_id}</small>
                        {modelOption.unavailable ? <em>{t('settings.agent.catalog.unavailable')}</em> : null}
                      </span>
                    )
                  }}
                  onChange={(value) => {
                    const selected = value
                      ? runtime.models.find(({ id }) => id === value)
                      : undefined
                    const reasoning = selected && !selected.supports_reasoning
                      ? 'off'
                      : readiness.settings.default_reasoning_level
                    consume(runtime.updateSettings(value ?? '', reasoning))
                  }}
                />
              </label>
              <label className={styles['agent-control-field']}>
                <span>{t('settings.agent.defaults.reasoning')}</span>
                <Select
                  value={readiness.settings.default_reasoning_level}
                  disabled={busy}
                  aria-label={t('settings.agent.defaults.reasoning')}
                  className={customSelectStyles.select}
                  classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                  options={(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as AgentReasoningLevel[])
                    .map((value) => ({
                      value,
                      label: t(`settings.agent.reasoning.${value}`),
                      disabled: value !== 'off' && Boolean(defaultModel && !defaultModel.supports_reasoning),
                    }))}
                  onChange={(value) => consume(runtime.updateSettings(
                    readiness.settings.default_model_id ?? '',
                    value,
                  ))}
                />
              </label>
            </div>
            {defaultModel && !isAgentModelRunnable(defaultModel, providerById.get(defaultModel.provider_id)) ? (
              <Alert
                className={styles['agent-setting-alert']}
                type="warning"
                showIcon
                title={t('settings.agent.defaults.unavailableTitle')}
                description={t('settings.agent.defaults.unavailableDescription')}
              />
            ) : null}
          </section>

          <section className={styles['agent-setting-row']} aria-labelledby="agent-policy-title">
            <span className={styles['agent-setting-icon']} aria-hidden="true">
              <ShieldCheck size={16} />
            </span>
            <div className={styles['agent-setting-copy']}>
              <strong id="agent-policy-title">{t('settings.agent.policy.title')}</strong>
              <span>{t('settings.agent.policy.description')}</span>
            </div>
            {readiness.mcp_policy ? (
              <div className={styles['policy-control']}>
                <span>{t(readiness.mcp_policy.approval_bypass
                  ? 'settings.agent.policy.bypass'
                  : 'settings.agent.policy.review')}</span>
                <Switch
                  aria-label={t('settings.agent.policy.approval')}
                  checked={readiness.mcp_policy.approval_bypass}
                  loading={runtime.mutation === 'policy'}
                  disabled={busy}
                  onChange={(checked) => checked
                    ? setConfirmBypass(true)
                    : consume(runtime.updatePolicy(false))}
                />
              </div>
            ) : <p className={styles.empty}>{t('settings.agent.policy.unavailable')}</p>}
            {readiness.mcp_policy?.scope_sync_required ? (
              <div className={styles['scope-sync']}>
                <div>
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{t('settings.agent.policy.scopeOutdated', {
                    current: readiness.mcp_policy.scope_count,
                    required: readiness.mcp_policy.required_scope_count,
                  })}</span>
                </div>
                <Button
                  size="small"
                  disabled={busy}
                  loading={runtime.mutation === 'policy'}
                  onClick={() => consume(runtime.updatePolicy(
                    readiness.mcp_policy?.approval_bypass ?? false,
                    true,
                  ))}
                >
                  {t('settings.agent.policy.sync')}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <ConfirmDialog
        open={confirmBypass}
        title={t('settings.agent.confirmBypass.title')}
        description={t('settings.agent.confirmBypass.description')}
        confirmLabel={t('settings.agent.confirmBypass.confirm')}
        danger
        confirmLoading={runtime.mutation === 'policy'}
        onCancel={() => setConfirmBypass(false)}
        onConfirm={() => consume(runtime.updatePolicy(true).then(() => setConfirmBypass(false)))}
      />
    </>
  )
}

function ReadinessItem({ label, component }: {
  label: string
  component: AgentReadinessComponent
}) {
  const { t } = useTranslation()
  return (
    <div className={styles['readiness-item']}>
      <span
        className={`${styles['readiness-icon']} ${styles[`is-${component.status}`]}`}
        aria-hidden="true"
      >
        {component.status === 'ready' ? <Check size={14} /> : <CircleAlert size={14} />}
      </span>
      <span className={styles['readiness-copy']}>
        <strong>{label}</strong>
        <span className={`${styles['readiness-state']} ${styles[`is-${component.status}`]}`}>
          <i aria-hidden="true" />
          {t(`settings.agent.componentState.${component.status}`)}
        </span>
      </span>
    </div>
  )
}

function buildModelOptions(providers: AgentModelProvider[], models: AgentModel[]) {
  const modelsByProvider = new Map<string, AgentModel[]>()
  for (const model of models) {
    const items = modelsByProvider.get(model.provider_id) ?? []
    items.push(model)
    modelsByProvider.set(model.provider_id, items)
  }
  return providers.map((provider) => ({
    label: provider.name,
    title: provider.name,
    options: (modelsByProvider.get(provider.id) ?? []).map((model): AgentModelSelectOption => ({
      value: model.id,
      disabled: !isAgentModelRunnable(model, provider),
      label: model.display_name,
      provider_name: provider.name,
      remote_model_id: model.remote_model_id,
      search_text: `${model.display_name} ${provider.name} ${model.remote_model_id}`.toLocaleLowerCase(),
      unavailable: !isAgentModelRunnable(model, provider),
    })),
  })).filter(({ options }) => options.length > 0)
}

interface AgentModelSelectOption {
  value: string
  label: string
  disabled: boolean
  provider_name: string
  remote_model_id: string
  search_text: string
  unavailable: boolean
}

function isAgentModelSelectOption(value: unknown): value is AgentModelSelectOption {
  return Boolean(value && typeof value === 'object' && 'value' in value && 'remote_model_id' in value)
}

function consume(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}
