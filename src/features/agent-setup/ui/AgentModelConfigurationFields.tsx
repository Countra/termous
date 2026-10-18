import { useId, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Button, Checkbox, Input, InputNumber, Segmented, Select, Switch } from 'antd'
import { CircleOff, Fingerprint, Globe2, Image, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { agentReasoningLevels, type AgentModel, type AgentSettings } from '#entities/agent'
import { customSelectStyles } from '#shared/ui'
import {
  resolveEffectiveReasoningLevel,
  type AgentModelDraft,
} from '../model/agentModelEditorDraft.ts'
import styles from './AgentModelConfigurationFields.module.scss'

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
    <div className={styles.configuration}>
      <EditorSection title={t('settings.agent.modelEditor.identitySection')}
        icon={<Fingerprint size={14} aria-hidden="true" />} className={styles.identity}>
        <div className={styles.grid}>
          <Field label={t('settings.agent.modelEditor.modelId')}>
            <Input
              className={styles['model-id']}
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
          <Field label={t('settings.agent.modelEditor.displayName')}>
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

      <EditorSection title={t('settings.agent.modelEditor.capabilitiesSection')}
        icon={<Sparkles size={14} aria-hidden="true" />}>
        <div className={styles['capability-row']}>
          <span><Image size={14} aria-hidden="true" />{t('settings.agent.modelEditor.images')}</span>
          <Switch
            size="small"
            checked={draft.supportsImages}
            disabled={busy}
            aria-label={t('settings.agent.modelEditor.images')}
            onChange={(supportsImages) => setDraft((current) => ({ ...current, supportsImages }))}
          />
        </div>
        <FieldGroup label={t('settings.agent.modelEditor.reasoningControl')} inline>
          <Segmented
            block
            value={draft.reasoningControl}
            disabled={busy}
            className={styles['editor-segmented']}
            aria-label={t('settings.agent.modelEditor.reasoningControl')}
            options={[
              { value: 'none', icon: <CircleOff size={13} aria-hidden="true" />, label: t('settings.agent.modelEditor.reasoningNone') },
              { value: 'openai_effort', icon: <Sparkles size={13} aria-hidden="true" />, label: t('settings.agent.modelEditor.reasoningEffort') },
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

      <EditorSection title={t('settings.agent.modelEditor.parametersSection')}
        icon={<SlidersHorizontal size={14} aria-hidden="true" />}>
        <FieldGroup label={t('settings.agent.modelEditor.parameterMode')} inline>
          <Segmented
            block
            value={draft.parameterMode}
            disabled={busy}
            className={styles['editor-segmented']}
            aria-label={t('settings.agent.modelEditor.parameterMode')}
            options={[
              { value: 'inherit_global', icon: <Globe2 size={13} aria-hidden="true" />, label: t('settings.agent.modelEditor.inheritGlobal') },
              { value: 'custom', icon: <SlidersHorizontal size={13} aria-hidden="true" />, label: t('settings.agent.modelEditor.customParameters') },
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
    </div>
  )
}

function EditorSection({ title, icon, className = '', children }: {
  title: string
  icon: ReactNode
  className?: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section className={`${styles.section} ${className}`} aria-labelledby={titleId}>
      <h4 id={titleId}>{icon}{title}</h4>
      <div className={styles.panel}>{children}</div>
    </section>
  )
}

function Field({ label, wide = false, children }: {
  label: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={`${styles.field} ${wide ? styles['is-wide'] : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function FieldGroup({ label, inline = false, children }: { label: string; inline?: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.field} ${inline ? styles['inline-field'] : ''}`}>
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
