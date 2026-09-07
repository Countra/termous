import { Button, Checkbox, Input, InputNumber, Segmented, Select, Switch, Tooltip } from 'antd'
import { Braces, File, Filter, Folder, Link2, Regex, TextSearch } from 'lucide-react'
import { useId, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import type {
  AdvancedRenameRule,
  AdvancedRenameRuleCondition,
  AdvancedRenameTarget,
  AdvancedRenameVariableDefinition,
} from '#entities/file'
import { FilterPopover, customSelectStyles } from '#shared/ui'
import {
  advancedRenamePlaceholders,
  advancedRenameVariableToken,
} from '../model/advancedRenameModel'
import styles from './AdvancedRenameModal.module.scss'

interface RuleConfigEditorProps {
  rule: AdvancedRenameRule
  variableDefinitions: readonly AdvancedRenameVariableDefinition[]
  disabled: boolean
  onChange: (rule: AdvancedRenameRule) => void
}

const targets: AdvancedRenameTarget[] = ['name', 'stem', 'extension']

const conditionKindChoices = [
  { value: 'file', icon: File },
  { value: 'directory', icon: Folder },
  { value: 'symlink', icon: Link2 },
] as const

const styledSelectProps = {
  className: customSelectStyles.select,
  classNames: {
    popup: {
      root: `${customSelectStyles['select-popup']} ${styles['control-popup']}`,
    },
  },
}

export function RuleConfigEditor({ rule, variableDefinitions, disabled, onChange }: RuleConfigEditorProps) {
  const { t } = useTranslation()
  const updateConfig = (patch: Record<string, unknown>) => onChange({
    ...rule,
    config: { ...rule.config, ...patch },
  } as AdvancedRenameRule)
  const targetOptions = targets.map((value) => ({
    value,
    label: t(`files.advancedRename.target.${value}`),
  }))
  const tokenOptions = useMemo(() => [
    ...advancedRenamePlaceholders.map((item) => ({
      token: item.token,
      label: t(item.labelKey),
    })),
    ...variableDefinitions.map((definition) => ({
      token: advancedRenameVariableToken(definition.name),
      label: definition.label || definition.name,
    })),
  ], [t, variableDefinitions])
  const replacementTokenOptions = rule.kind === 'replace' && rule.config.regex
    ? [
        { token: '$1', label: t('files.advancedRename.regex.captureNumber') },
        { token: '${name}', label: t('files.advancedRename.regex.captureName') },
        ...tokenOptions,
      ]
    : tokenOptions

  return (
    <div className={styles['rule-editor']}>
      <div className={styles['rule-fields']}>
      {rule.kind === 'template' ? (
        <Field label={t('files.advancedRename.fields.template')} wide>
          <TokenEditor
            value={rule.config.template}
            tokens={tokenOptions}
            disabled={disabled}
            onChange={(template) => updateConfig({ template })}
          />
        </Field>
      ) : null}
      {rule.kind === 'insert' ? (
        <>
          <Field label={t('files.advancedRename.fields.text')} wide>
            <TokenEditor
              value={rule.config.text}
              tokens={tokenOptions}
              disabled={disabled}
              onChange={(text) => updateConfig({ text })}
            />
          </Field>
          <Field label={t('files.advancedRename.fields.position')}>
            <Select
              {...styledSelectProps}
              value={rule.config.position}
              disabled={disabled}
              options={['prefix', 'suffix', 'index'].map((value) => ({
                value,
                label: t(`files.advancedRename.position.${value}`),
              }))}
              onChange={(position) => updateConfig({ position })}
            />
          </Field>
          {rule.config.position === 'index' ? (
            <NumberField
              label={t('files.advancedRename.fields.index')}
              value={rule.config.index ?? 0}
              minimum={0}
              disabled={disabled}
              onChange={(index) => updateConfig({ index })}
            />
          ) : null}
          <Field label={t('files.advancedRename.fields.target')}>
            <Select {...styledSelectProps} value={rule.config.target} disabled={disabled} options={targetOptions} onChange={(target) => updateConfig({ target })} />
          </Field>
        </>
      ) : null}
      {rule.kind === 'replace' ? (
        <>
          <Field label={t('files.advancedRename.fields.matchMode')} wide>
            <Segmented
              block
              className={styles['match-mode']}
              value={rule.config.regex ? 'regex' : 'literal'}
              disabled={disabled}
              options={[
                { value: 'literal', label: t('files.advancedRename.matchMode.literal'), icon: <TextSearch size={13} /> },
                { value: 'regex', label: t('files.advancedRename.matchMode.regex'), icon: <Regex size={13} /> },
              ]}
              onChange={(mode) => updateConfig({ regex: mode === 'regex' })}
            />
          </Field>
          <Field label={t('files.advancedRename.fields.search')} wide>
            <Input
              className={rule.config.regex ? styles['regex-input'] : undefined}
              value={rule.config.search}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => updateConfig({ search: event.target.value })}
            />
          </Field>
          {rule.config.regex ? (
            <p className={styles['regex-hint']}>
              <Regex size={13} aria-hidden="true" />
              <span>{t('files.advancedRename.regex.hint')}</span>
            </p>
          ) : null}
          <Field label={t('files.advancedRename.fields.replacement')} wide>
            <TokenEditor
              value={rule.config.replacement}
              tokens={replacementTokenOptions}
              disabled={disabled}
              onChange={(replacement) => updateConfig({ replacement })}
            />
          </Field>
          <SwitchField label={t('files.advancedRename.fields.replaceAll')} checked={rule.config.replace_all} disabled={disabled} onChange={(replace_all) => updateConfig({ replace_all })} />
          <SwitchField label={t('files.advancedRename.fields.caseSensitive')} checked={rule.config.case_sensitive} disabled={disabled} onChange={(case_sensitive) => updateConfig({ case_sensitive })} />
          <Field label={t('files.advancedRename.fields.target')}>
            <Select {...styledSelectProps} value={rule.config.target} disabled={disabled} options={targetOptions} onChange={(target) => updateConfig({ target })} />
          </Field>
        </>
      ) : null}
      {rule.kind === 'slice' ? (
        <>
          <Field label={t('files.advancedRename.fields.mode')}>
            <Select
              {...styledSelectProps}
              value={rule.config.mode}
              disabled={disabled}
              options={['remove', 'keep'].map((value) => ({ value, label: t(`files.advancedRename.sliceMode.${value}`) }))}
              onChange={(mode) => updateConfig({ mode })}
            />
          </Field>
          <NumberField label={t('files.advancedRename.fields.start')} value={rule.config.start} minimum={0} disabled={disabled} onChange={(start) => updateConfig({ start })} />
          <NumberField label={t('files.advancedRename.fields.length')} value={rule.config.length ?? 0} minimum={0} disabled={disabled} onChange={(length) => updateConfig({ length })} />
          <SwitchField label={t('files.advancedRename.fields.fromEnd')} checked={rule.config.from_end} disabled={disabled} onChange={(from_end) => updateConfig({ from_end })} />
          <Field label={t('files.advancedRename.fields.target')}>
            <Select {...styledSelectProps} value={rule.config.target} disabled={disabled} options={targetOptions} onChange={(target) => updateConfig({ target })} />
          </Field>
        </>
      ) : null}
      {rule.kind === 'case' ? (
        <>
          <Field label={t('files.advancedRename.fields.mode')}>
            <Select
              {...styledSelectProps}
              value={rule.config.mode}
              disabled={disabled}
              options={['lower', 'upper', 'title'].map((value) => ({ value, label: t(`files.advancedRename.caseMode.${value}`) }))}
              onChange={(mode) => updateConfig({ mode })}
            />
          </Field>
          <Field label={t('files.advancedRename.fields.target')}>
            <Select {...styledSelectProps} value={rule.config.target} disabled={disabled} options={targetOptions} onChange={(target) => updateConfig({ target })} />
          </Field>
        </>
      ) : null}
      {rule.kind === 'cleanup' ? (
        <>
          <SwitchField label={t('files.advancedRename.fields.trimWhitespace')} checked={rule.config.trim_whitespace} disabled={disabled} onChange={(trim_whitespace) => updateConfig({ trim_whitespace })} />
          <Field label={t('files.advancedRename.fields.separator')}>
            <Input value={rule.config.separator ?? ''} disabled={disabled} onChange={(event) => updateConfig({ separator: event.target.value })} />
          </Field>
          <SwitchField label={t('files.advancedRename.fields.collapseSeparator')} checked={rule.config.collapse_separator} disabled={disabled} onChange={(collapse_separator) => updateConfig({ collapse_separator })} />
          <Field label={t('files.advancedRename.fields.target')}>
            <Select {...styledSelectProps} value={rule.config.target} disabled={disabled} options={targetOptions} onChange={(target) => updateConfig({ target })} />
          </Field>
        </>
      ) : null}
      {rule.kind === 'sequence' ? (
        <>
          <Field label={t('files.advancedRename.fields.position')}>
            <Select
              {...styledSelectProps}
              value={rule.config.position}
              disabled={disabled}
              options={['prefix', 'suffix', 'index'].map((value) => ({ value, label: t(`files.advancedRename.position.${value}`) }))}
              onChange={(position) => updateConfig({ position })}
            />
          </Field>
          {rule.config.position === 'index' ? (
            <NumberField label={t('files.advancedRename.fields.index')} value={rule.config.index ?? 0} minimum={0} disabled={disabled} onChange={(index) => updateConfig({ index })} />
          ) : null}
          <NumberField label={t('files.advancedRename.fields.start')} value={rule.config.start} disabled={disabled} onChange={(start) => updateConfig({ start })} />
          <NumberField label={t('files.advancedRename.fields.step')} value={rule.config.step} allowZero={false} disabled={disabled} onChange={(step) => updateConfig({ step })} />
          <NumberField label={t('files.advancedRename.fields.width')} value={rule.config.width} minimum={1} maximum={12} disabled={disabled} onChange={(width) => updateConfig({ width })} />
          <Field label={t('files.advancedRename.fields.target')}>
            <Select {...styledSelectProps} value={rule.config.target} disabled={disabled} options={targetOptions} onChange={(target) => updateConfig({ target })} />
          </Field>
        </>
      ) : null}
      {rule.kind === 'extension' ? (
        <>
          <Field label={t('files.advancedRename.fields.mode')}>
            <Select
              {...styledSelectProps}
              value={rule.config.mode}
              disabled={disabled}
              options={['set', 'remove', 'lower', 'upper'].map((value) => ({ value, label: t(`files.advancedRename.extensionMode.${value}`) }))}
              onChange={(mode) => updateConfig({ mode })}
            />
          </Field>
          {rule.config.mode === 'set' ? (
            <Field label={t('files.advancedRename.fields.extension')}>
              <Input value={rule.config.value ?? ''} disabled={disabled} onChange={(event) => updateConfig({ value: event.target.value })} />
            </Field>
          ) : null}
        </>
      ) : null}
      </div>
      <ConditionEditor rule={rule} disabled={disabled} onChange={onChange} />
    </div>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`${styles.field} ${wide ? styles['is-wide'] : ''}`}><span>{label}</span>{children}</label>
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.field}><span>{label}</span>{children}</div>
}

function NumberField({
  label,
  value,
  minimum,
  maximum,
  allowZero = true,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  minimum?: number
  maximum?: number
  allowZero?: boolean
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <InputNumber
        value={value}
        min={minimum}
        max={maximum}
        precision={0}
        step={1}
        disabled={disabled}
        onChange={(next) => {
          if (
            next === null
            || !Number.isInteger(next)
            || (!allowZero && next === 0)
            || (minimum !== undefined && next < minimum)
            || (maximum !== undefined && next > maximum)
          ) {
            return
          }
          onChange(next)
        }}
      />
    </Field>
  )
}

function SwitchField({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={styles['switch-field']}><span>{label}</span><Switch size="small" checked={checked} disabled={disabled} onChange={onChange} /></label>
}

function TokenEditor({ value, tokens, disabled, onChange }: { value: string; tokens: { token: string; label: string }[]; disabled: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation()
  const inputRef = useRef<TextAreaRef>(null)
  const insertToken = (token: string) => {
    const nativeElement = inputRef.current?.nativeElement
    const input = nativeElement instanceof HTMLTextAreaElement
      ? nativeElement
      : nativeElement?.querySelector('textarea')
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? start
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`
    onChange(next)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      const nextNativeElement = inputRef.current?.nativeElement
      const nextInput = nextNativeElement instanceof HTMLTextAreaElement
        ? nextNativeElement
        : nextNativeElement?.querySelector('textarea')
      nextInput?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <div className={styles['token-editor']}>
      <Input.TextArea
        ref={inputRef}
        value={value}
        disabled={disabled}
        autoSize={{ minRows: 2, maxRows: 5 }}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={styles['token-editor-action']}>
        <FilterPopover
          placement="bottomRight"
          popupClassName={styles['control-popup']}
          content={<div className={styles['token-menu']}>{tokens.map((token) => (
            <button type="button" key={token.token} onClick={() => insertToken(token.token)}>
              <span>{token.label}</span><code>{token.token}</code>
            </button>
          ))}</div>}
        >
          <Tooltip title={t('files.advancedRename.insertField')}>
            <Button type="text" size="small" disabled={disabled} aria-label={t('files.advancedRename.insertField')} icon={<Braces size={14} />} />
          </Tooltip>
        </FilterPopover>
      </span>
    </div>
  )
}

function ConditionEditor({ rule, disabled, onChange }: { rule: AdvancedRenameRule; disabled: boolean; onChange: (rule: AdvancedRenameRule) => void }) {
  const { t } = useTranslation()
  const nameInputId = useId()
  const enabled = Boolean(rule.condition)
  const condition = rule.condition ?? {}
  const update = (patch: Partial<AdvancedRenameRuleCondition>) => onChange({ ...rule, condition: { ...condition, ...patch } })
  return (
    <div className={`${styles.condition} ${enabled ? styles['is-enabled'] : ''}`}>
      <div className={styles['condition-toggle']}>
        <span className={styles['condition-title']}>
          <span className={styles['condition-title-icon']}>
            <Filter size={14} aria-hidden="true" />
          </span>
          <span>{t('files.advancedRename.condition.title')}</span>
        </span>
        <Switch
          size="small"
          checked={enabled}
          disabled={disabled}
          aria-label={t('files.advancedRename.condition.title')}
          onChange={(checked) => onChange({ ...rule, condition: checked ? {} : undefined })}
        />
      </div>
      {enabled ? (
        <div className={styles['condition-fields']}>
          <Field label={t('files.advancedRename.fields.matchMode')}>
            <Segmented
              block
              className={`${styles['match-mode']} ${styles['condition-match-mode']}`}
              value={condition.original_name?.regex ? 'regex' : 'literal'}
              disabled={disabled}
              options={[
                { value: 'literal', label: t('files.advancedRename.matchMode.contains') },
                { value: 'regex', label: t('files.advancedRename.matchMode.regex') },
              ]}
              onChange={(mode) => update({ original_name: {
                pattern: condition.original_name?.pattern ?? '',
                regex: mode === 'regex',
                case_sensitive: condition.original_name?.case_sensitive ?? true,
              } })}
            />
          </Field>
          <div className={styles.field}>
            <div className={styles['condition-field-heading']}>
              <label htmlFor={nameInputId}>{t('files.advancedRename.condition.name')}</label>
              <span className={styles['condition-inline-switch']}>
                <span>{t('files.advancedRename.fields.caseSensitive')}</span>
                <Switch
                  size="small"
                  checked={condition.original_name?.case_sensitive ?? true}
                  disabled={disabled}
                  aria-label={t('files.advancedRename.fields.caseSensitive')}
                  onChange={(case_sensitive) => update({ original_name: {
                    pattern: condition.original_name?.pattern ?? '',
                    regex: condition.original_name?.regex ?? false,
                    case_sensitive,
                  } })}
                />
              </span>
            </div>
            <Input
              id={nameInputId}
              className={condition.original_name?.regex ? styles['regex-input'] : undefined}
              value={condition.original_name?.pattern ?? ''}
              disabled={disabled}
              onChange={(event) => update({ original_name: {
                pattern: event.target.value,
                regex: condition.original_name?.regex ?? false,
                case_sensitive: condition.original_name?.case_sensitive ?? true,
              } })}
            />
          </div>
          {condition.original_name?.regex ? (
            <p className={styles['regex-hint']}>
              <Regex size={13} aria-hidden="true" />
              <span>{t('files.advancedRename.regex.conditionHint')}</span>
            </p>
          ) : null}
          <FieldGroup label={t('files.advancedRename.condition.kinds')}>
            <Checkbox.Group
              className={styles['condition-kind-options']}
              aria-label={t('files.advancedRename.condition.kinds')}
              value={condition.kinds ?? []}
              disabled={disabled}
              onChange={(kinds) => update({ kinds: kinds as AdvancedRenameRuleCondition['kinds'] })}
            >
              {conditionKindChoices.map(({ value, icon: KindIcon }) => (
                <Checkbox key={value} value={value} className={styles['condition-kind-option']}>
                  <span className={styles['condition-kind-label']}>
                    <KindIcon size={13} aria-hidden="true" />
                    <span>{t(`files.kindName.${value}`)}</span>
                  </span>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </FieldGroup>
          <Field label={t('files.advancedRename.condition.extensions')}>
            <Input
              value={(condition.extensions ?? []).join(', ')}
              disabled={disabled}
              onChange={(event) => update({ extensions: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}
