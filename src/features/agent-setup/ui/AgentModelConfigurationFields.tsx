import type { Dispatch, SetStateAction } from 'react'
import { Button, Checkbox, Input, InputNumber, Segmented, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { agentReasoningLevels, type AgentModel, type AgentSettings } from '#entities/agent'
import { customSelectStyles } from '#shared/ui'
import {
  resolveEffectiveReasoningLevel,
  type AgentModelDraft,
} from '../model/agentModelEditorDraft.ts'
import styles from './AgentModelEditorDialog.module.scss'

interface AgentModelConfigurationFieldsProps {
  draft: AgentModelDraft
  setDraft: Dispatch<SetStateAction<AgentModelDraft>>
  model?: AgentModel
  settings?: AgentSettings
  editing: boolean
  busy: boolean
}

export function AgentModelConfigurationFields({
  draft,
  setDraft,
  model,
  settings,
  editing,
  busy,
}: AgentModelConfigurationFieldsProps) {
  const { t } = useTranslation()
  const effectiveReasoning = resolveEffectiveReasoningLevel(
    draft.parameterMode === 'inherit_global'
      ? settings?.default_reasoning_level ?? 'off'
      : draft.defaultReasoningLevel,
    draft.supportedReasoningLevels,
  )
  const effectiveContext = model?.parameter_mode === 'inherit_global'
    ? model.effective_context_window_tokens
    : settings?.global_context_window_tokens ?? 16_384
  const effectiveOutput = model?.parameter_mode === 'inherit_global'
    ? model.effective_max_output_tokens
    : settings?.global_max_output_tokens ?? 4_096
  const availableDefaultLevels = draft.reasoningControl === 'none'
    ? ['off']
    : draft.supportedReasoningLevels
  const allReasoningLevelsSelected = agentReasoningLevels.every((level) => (
    draft.supportedReasoningLevels.includes(level)
  ))

  const updateReasoningControl = (reasoningControl: AgentModelDraft['reasoningControl']) => {
    setDraft((current) => reasoningControl === 'none'
      ? {
          ...current,
          reasoningControl,
          supportedReasoningLevels: ['off'],
          defaultReasoningLevel: 'off',
        }
      : {
          ...current,
          reasoningControl,
          supportedReasoningLevels: [...agentReasoningLevels],
          defaultReasoningLevel: 'off',
        })
  }

  const updateSupportedLevels = (values: Array<string | number>) => {
    const selected = agentReasoningLevels.filter((level) => values.includes(level))
    setDraft((current) => ({
      ...current,
      supportedReasoningLevels: selected,
      defaultReasoningLevel: selected.includes(current.defaultReasoningLevel)
        ? current.defaultReasoningLevel
        : resolveEffectiveReasoningLevel(current.defaultReasoningLevel, selected),
    }))
  }

  return (
    <>
      <EditorSection title={t('settings.agent.modelEditor.identitySection')}>
        <div className={styles.grid}>
          <Field label={t('settings.agent.modelEditor.modelId')} wide>
            <Input
              autoFocus={!editing}
              value={draft.remoteModelId}
              maxLength={200}
              disabled={busy || editing}
              placeholder={t('settings.agent.modelEditor.modelIdPlaceholder')}
              onChange={(event) => setDraft((current) => ({
                ...current,
                remoteModelId: event.target.value,
              }))}
            />
          </Field>
          <Field label={t('settings.agent.modelEditor.displayName')} wide>
            <Input
              value={draft.displayName}
              maxLength={200}
              disabled={busy}
              placeholder={t('settings.agent.modelEditor.displayNamePlaceholder')}
              onChange={(event) => setDraft((current) => ({
                ...current,
                displayName: event.target.value,
              }))}
            />
          </Field>
        </div>
      </EditorSection>

      <EditorSection title={t('settings.agent.modelEditor.parametersSection')}>
        <FieldGroup label={t('settings.agent.modelEditor.parameterMode')}>
          <Segmented
            block
            value={draft.parameterMode}
            disabled={busy}
            className={styles['editor-segmented']}
            aria-label={t('settings.agent.modelEditor.parameterMode')}
            options={[
              { value: 'inherit_global', label: t('settings.agent.modelEditor.inheritGlobal') },
              { value: 'custom', label: t('settings.agent.modelEditor.customParameters') },
            ]}
            onChange={(parameterMode) => setDraft((current) => ({
              ...current,
              parameterMode: parameterMode as AgentModelDraft['parameterMode'],
            }))}
          />
        </FieldGroup>
        {draft.parameterMode === 'inherit_global' ? (
          <div className={styles['effective-values']}>
            <EffectiveValue
              label={t('settings.agent.modelEditor.contextBudget')}
              value={formatTokens(effectiveContext)}
            />
            <EffectiveValue
              label={t('settings.agent.modelEditor.maxOutput')}
              value={formatTokens(effectiveOutput)}
            />
            <EffectiveValue
              label={t('settings.agent.modelEditor.defaultReasoning')}
              value={t(`settings.agent.reasoning.${effectiveReasoning}`)}
            />
          </div>
        ) : (
          <div className={styles.grid}>
            <Field label={t('settings.agent.modelEditor.contextBudget')}>
              <InputNumber
                value={draft.contextWindowTokens}
                min={1024}
                max={2_000_000}
                step={1024}
                precision={0}
                disabled={busy}
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  contextWindowTokens: value ?? 1024,
                }))}
              />
            </Field>
            <Field label={t('settings.agent.modelEditor.maxOutput')}>
              <InputNumber
                value={draft.maxOutputTokens}
                min={1}
                max={draft.contextWindowTokens}
                step={256}
                precision={0}
                disabled={busy}
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  maxOutputTokens: value ?? 1,
                }))}
              />
            </Field>
            <Field label={t('settings.agent.modelEditor.defaultReasoning')} wide>
              <Select
                value={draft.defaultReasoningLevel}
                disabled={busy}
                className={customSelectStyles.select}
                classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                options={availableDefaultLevels.map((level) => ({
                  value: level,
                  label: t(`settings.agent.reasoning.${level}`),
                }))}
                onChange={(defaultReasoningLevel) => setDraft((current) => ({
                  ...current,
                  defaultReasoningLevel,
                }))}
              />
            </Field>
          </div>
        )}
      </EditorSection>

      <EditorSection title={t('settings.agent.modelEditor.capabilitiesSection')}>
        <div className={styles['capability-row']}>
          <span>{t('settings.agent.modelEditor.images')}</span>
          <Switch
            checked={draft.supportsImages}
            disabled={busy}
            aria-label={t('settings.agent.modelEditor.images')}
            onChange={(supportsImages) => setDraft((current) => ({ ...current, supportsImages }))}
          />
        </div>
        <FieldGroup label={t('settings.agent.modelEditor.reasoningControl')}>
          <Segmented
            block
            value={draft.reasoningControl}
            disabled={busy}
            className={styles['editor-segmented']}
            aria-label={t('settings.agent.modelEditor.reasoningControl')}
            options={[
              { value: 'none', label: t('settings.agent.modelEditor.reasoningNone') },
              { value: 'openai_effort', label: t('settings.agent.modelEditor.reasoningEffort') },
            ]}
            onChange={(value) => updateReasoningControl(value as AgentModelDraft['reasoningControl'])}
          />
        </FieldGroup>
        {draft.reasoningControl === 'openai_effort' ? (
          <div className={styles['reasoning-options']}>
            <div className={styles['reasoning-options-header']}>
              <span>{t('settings.agent.modelEditor.reasoningLevels')}</span>
              <Button
                type="text"
                size="small"
                disabled={busy || allReasoningLevelsSelected}
                className={styles['reasoning-select-all']}
                onClick={() => updateSupportedLevels([...agentReasoningLevels])}
              >
                {t('settings.agent.modelEditor.selectAllReasoningLevels')}
              </Button>
            </div>
            <Checkbox.Group
              className={styles['reasoning-levels']}
              value={draft.supportedReasoningLevels}
              disabled={busy}
              aria-label={t('settings.agent.modelEditor.reasoningLevels')}
              onChange={updateSupportedLevels}
            >
              {agentReasoningLevels.map((level) => (
                <Checkbox key={level} value={level}>
                  {t(`settings.agent.reasoning.${level}`)}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
        ) : null}
      </EditorSection>
    </>
  )
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  )
}

function Field({ label, wide = false, children }: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`${styles.field} ${wide ? styles['is-wide'] : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={`${styles.field} ${styles['is-wide']}`}>
      <span>{label}</span>
      {children}
    </div>
  )
}

function EffectiveValue({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>
}

function formatTokens(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
