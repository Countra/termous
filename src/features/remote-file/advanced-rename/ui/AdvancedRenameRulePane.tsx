import { Button, Checkbox, Dropdown, Input, Select, Switch, Tooltip } from 'antd'
import {
  ArrowDown,
  ArrowUp,
  CaseUpper,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Eraser,
  FilePenLine,
  FileType,
  GripVertical,
  ListPlus,
  ListOrdered,
  Plus,
  Regex,
  Replace,
  Scissors,
  TextCursorInput,
  Trash2,
  Variable,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AdvancedRenameOrder,
  AdvancedRenameRule,
  AdvancedRenameVariableDefinition,
} from '#entities/file'
import {
  contextActionMenuPopupClassName,
  customSelectStyles,
} from '#shared/ui'
import {
  advancedRenameRuleChoice,
  advancedRenameRuleChoices,
  advancedRenameRuleLimit,
  advancedRenameVariableLimit,
  type AdvancedRenameRuleChoice,
  type AdvancedRenameVariableDefinitionError,
} from '../model/advancedRenameModel'
import { RuleConfigEditor } from './RuleConfigEditor'
import styles from './AdvancedRenameModal.module.scss'

interface AdvancedRenameRulePaneProps {
  rules: readonly AdvancedRenameRule[]
  order: AdvancedRenameOrder
  variableDefinitions: readonly AdvancedRenameVariableDefinition[]
  variables: Readonly<Record<string, string>>
  variableDefinitionErrors: readonly AdvancedRenameVariableDefinitionError[]
  ruleDiagnostics: Readonly<Record<string, string[]>>
  disabled: boolean
  onAddRule: (kind: AdvancedRenameRuleChoice) => void
  onUpdateRule: (rule: AdvancedRenameRule) => void
  onRemoveRule: (ruleId: string) => void
  onDuplicateRule: (ruleId: string) => void
  onMoveRule: (ruleId: string, targetIndex: number) => void
  onOrderChange: (order: AdvancedRenameOrder) => void
  onVariableDefinitionsChange: (definitions: AdvancedRenameVariableDefinition[]) => void
  onVariablesChange: (variables: Record<string, string>) => void
}

type RuleDropTarget = {
  id: string
  edge: 'before' | 'after'
}

const ruleChoiceIcons: Record<AdvancedRenameRuleChoice, LucideIcon> = {
  template: FilePenLine,
  insert: TextCursorInput,
  replace: Replace,
  regex: Regex,
  slice: Scissors,
  case: CaseUpper,
  cleanup: Eraser,
  sequence: ListOrdered,
  extension: FileType,
}

const ruleDragBlockedSelector = [
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[data-advanced-rename-drag-block]',
].join(',')

export function AdvancedRenameRulePane({
  rules,
  order,
  variableDefinitions,
  variables,
  variableDefinitionErrors,
  ruleDiagnostics,
  disabled,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  onDuplicateRule,
  onMoveRule,
  onOrderChange,
  onVariableDefinitionsChange,
  onVariablesChange,
}: AdvancedRenameRulePaneProps) {
  const { t } = useTranslation()
  const [expandedRuleId, setExpandedRuleId] = useState(rules[0]?.id ?? '')
  const previousRuleIdsRef = useRef(new Set(rules.map((rule) => rule.id)))
  const pendingRevealRuleIdRef = useRef('')
  const ruleElementsRef = useRef(new Map<string, HTMLElement>())
  const [draggingRuleId, setDraggingRuleId] = useState('')
  const [dropTarget, setDropTarget] = useState<RuleDropTarget | null>(null)
  const dropTargetRef = useRef<RuleDropTarget | null>(null)
  const dragOriginBlockedRef = useRef(false)

  useLayoutEffect(() => {
    const previousRuleIds = previousRuleIdsRef.current
    const addedRules = rules.filter((rule) => !previousRuleIds.has(rule.id))
    previousRuleIdsRef.current = new Set(rules.map((rule) => rule.id))
    if (addedRules.length === 1) {
      const addedRuleId = addedRules[0].id
      pendingRevealRuleIdRef.current = addedRuleId
      setExpandedRuleId(addedRuleId)
      return
    }
    setExpandedRuleId((current) => (
      current && !rules.some((rule) => rule.id === current)
        ? rules[0]?.id ?? ''
        : current
    ))
  }, [rules])

  useLayoutEffect(() => {
    const pendingRuleId = pendingRevealRuleIdRef.current
    if (!pendingRuleId || pendingRuleId !== expandedRuleId) {
      return
    }
    pendingRevealRuleIdRef.current = ''
    ruleElementsRef.current.get(pendingRuleId)?.scrollIntoView({ block: 'nearest' })
  }, [expandedRuleId])

  useEffect(() => {
    if (!draggingRuleId) {
      return
    }
    if (!disabled && rules.some((rule) => rule.id === draggingRuleId)) {
      return
    }
    setDraggingRuleId('')
    dropTargetRef.current = null
    setDropTarget(null)
  }, [disabled, draggingRuleId, rules])

  const resetRuleDrag = () => {
    dragOriginBlockedRef.current = false
    setDraggingRuleId('')
    dropTargetRef.current = null
    setDropTarget(null)
  }

  const isRuleDragBlockedTarget = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null
    const blockedTarget = element?.closest(ruleDragBlockedSelector)
    const button = element?.closest('button')
    return Boolean(blockedTarget || (button && !button.hasAttribute('data-advanced-rename-drag-allow')))
  }

  const startRuleDrag = (event: DragEvent<HTMLElement>, ruleId: string) => {
    if (
      disabled
      || rules.length < 2
      || dragOriginBlockedRef.current
      || isRuleDragBlockedTarget(event.target)
    ) {
      dragOriginBlockedRef.current = false
      event.preventDefault()
      return
    }
    dragOriginBlockedRef.current = false
    setDraggingRuleId(ruleId)
    dropTargetRef.current = null
    setDropTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', ruleId)
    const heading = event.currentTarget.querySelector('[data-advanced-rename-rule-heading]')
    if (heading instanceof HTMLElement) {
      event.dataTransfer.setDragImage(heading, 28, 24)
    }
  }

  const ruleDropEdge = (event: DragEvent<HTMLElement>): RuleDropTarget['edge'] => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  }

  const updateRuleDropTarget = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (!draggingRuleId || draggingRuleId === targetId || disabled) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const edge = ruleDropEdge(event)
    const current = dropTargetRef.current
    if (current?.id === targetId && current.edge === edge) {
      return
    }
    const next = { id: targetId, edge }
    dropTargetRef.current = next
    setDropTarget(next)
  }

  const finishRuleDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (!draggingRuleId || draggingRuleId === targetId || disabled) {
      resetRuleDrag()
      return
    }
    event.preventDefault()
    const sourceIndex = rules.findIndex((rule) => rule.id === draggingRuleId)
    const targetIndex = rules.findIndex((rule) => rule.id === targetId)
    const edge = ruleDropEdge(event)
    const insertionSlot = targetIndex + (edge === 'after' ? 1 : 0)
    const nextIndex = insertionSlot - (sourceIndex < insertionSlot ? 1 : 0)
    const sourceId = draggingRuleId
    resetRuleDrag()
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === nextIndex) {
      return
    }
    onMoveRule(sourceId, nextIndex)
  }

  const addVariable = () => {
    if (variableDefinitions.length >= advancedRenameVariableLimit) {
      return
    }
    let index = variableDefinitions.length + 1
    let name = `value${index}`
    const names = new Set(variableDefinitions.map((definition) => definition.name))
    while (names.has(name)) {
      index += 1
      name = `value${index}`
    }
    onVariableDefinitionsChange([...variableDefinitions, {
      name,
      label: t('files.advancedRename.variables.defaultLabel', { index }),
      description: '',
      default_value: '',
      required: false,
    }])
  }

  const updateVariable = (
    index: number,
    patch: Partial<AdvancedRenameVariableDefinition>,
  ) => {
    const previous = variableDefinitions[index]
    const next = variableDefinitions.map((definition, currentIndex) => (
      currentIndex === index ? { ...definition, ...patch } : definition
    ))
    onVariableDefinitionsChange(next)
    if (patch.name !== undefined && patch.name !== previous.name) {
      const nextValues = { ...variables }
      const hasOverride = Object.prototype.hasOwnProperty.call(nextValues, previous.name)
      const currentValue = nextValues[previous.name]
      delete nextValues[previous.name]
      if (hasOverride) {
        nextValues[patch.name] = currentValue
      }
      onVariablesChange(nextValues)
    }
  }

  const removeVariable = (index: number) => {
    const removed = variableDefinitions[index]
    onVariableDefinitionsChange(variableDefinitions.filter((_, currentIndex) => currentIndex !== index))
    const nextValues = { ...variables }
    delete nextValues[removed.name]
    onVariablesChange(nextValues)
  }

  return (
    <section className={styles['rules-pane']} aria-label={t('files.advancedRename.rules.title')}>
      <header className={styles['pane-heading']}>
        <span>
          <ListPlus size={15} aria-hidden="true" />
          {t('files.advancedRename.rules.title')}
          <small className={styles['pane-count']}>{rules.length}/{advancedRenameRuleLimit}</small>
        </span>
        <Dropdown
          disabled={disabled || rules.length >= advancedRenameRuleLimit}
          trigger={['click']}
          placement="bottomRight"
          classNames={{ root: `${contextActionMenuPopupClassName} ${styles['control-popup']} ${styles['rule-add-menu']}` }}
          menu={{
            items: advancedRenameRuleChoices.map((choice) => {
              const RuleIcon = ruleChoiceIcons[choice]
              const label = t(`files.advancedRename.ruleKind.${choice}`)
              const description = t(`files.advancedRename.ruleDescription.${choice}`)
              return {
                key: choice,
                label: (
                  <Tooltip
                    title={description}
                    placement="right"
                    mouseEnterDelay={0.35}
                    mouseLeaveDelay={0}
                    zIndex={3700}
                  >
                    <span className={styles['rule-menu-item']} aria-label={`${label}: ${description}`}>
                      <span className={styles['rule-menu-icon']}><RuleIcon size={15} aria-hidden="true" /></span>
                      <strong>{label}</strong>
                    </span>
                  </Tooltip>
                ),
              }
            }),
            onClick: ({ key }) => onAddRule(key as AdvancedRenameRuleChoice),
          }}
        >
          <Button className={styles['add-rule-button']} size="small" disabled={disabled || rules.length >= advancedRenameRuleLimit} icon={<Plus size={14} />}>
            {t('files.advancedRename.rules.add')}
            <ChevronDown size={13} aria-hidden="true" />
          </Button>
        </Dropdown>
      </header>

      <div className={styles['order-editor']}>
        <label>
          <span>{t('files.advancedRename.order.by')}</span>
          <Select
            className={customSelectStyles.select}
            classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['control-popup']}` } }}
            value={order.by}
            disabled={disabled}
            options={['selection', 'name', 'modified', 'size', 'kind'].map((value) => ({
              value,
              label: t(`files.advancedRename.order.${value}`),
            }))}
            onChange={(by) => onOrderChange({ ...order, by })}
          />
        </label>
        <label>
          <span>{t('files.advancedRename.order.direction')}</span>
          <Select
            className={customSelectStyles.select}
            classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['control-popup']}` } }}
            value={order.direction}
            disabled={disabled}
            options={['asc', 'desc'].map((value) => ({
              value,
              label: t(`files.advancedRename.order.${value}`),
            }))}
            onChange={(direction) => onOrderChange({ ...order, direction })}
          />
        </label>
      </div>

      <div className={styles['rule-list']}>
        {rules.map((rule, index) => {
          const expanded = expandedRuleId === rule.id
          const diagnostics = ruleDiagnostics[rule.id] ?? []
          const choice = advancedRenameRuleChoice(rule)
          const RuleIcon = ruleChoiceIcons[choice]
          const dropEdge = dropTarget?.id === rule.id ? dropTarget.edge : null
          return (
            <article
              key={rule.id}
              ref={(element) => {
                if (element) ruleElementsRef.current.set(rule.id, element)
                else ruleElementsRef.current.delete(rule.id)
              }}
              className={[
                styles.rule,
                expanded ? styles['is-expanded'] : '',
                !rule.enabled ? styles['is-disabled'] : '',
                diagnostics.length > 0 ? styles['has-error'] : '',
                !disabled && rules.length > 1 ? styles['is-reorderable'] : '',
                draggingRuleId === rule.id ? styles['is-dragging'] : '',
                dropEdge ? styles[`is-drop-${dropEdge}`] : '',
              ].filter(Boolean).join(' ')}
              data-advanced-rename-rule="true"
              draggable={!disabled && rules.length > 1}
              onPointerDownCapture={(event) => {
                dragOriginBlockedRef.current = isRuleDragBlockedTarget(event.target)
              }}
              onPointerUpCapture={() => {
                dragOriginBlockedRef.current = false
              }}
              onDragStart={(event) => startRuleDrag(event, rule.id)}
              onDragEnd={resetRuleDrag}
              onDragOver={(event) => updateRuleDropTarget(event, rule.id)}
              onDrop={(event) => finishRuleDrop(event, rule.id)}
            >
              <header className={styles['rule-heading']} data-advanced-rename-rule-heading="true">
                <Tooltip title={t('app.reorder')} mouseLeaveDelay={0}>
                  <span
                    className={styles['rule-drag-indicator']}
                    data-advanced-rename-drag-indicator="true"
                    aria-hidden="true"
                  >
                    <GripVertical size={16} strokeWidth={2.2} />
                  </span>
                </Tooltip>
                <button
                  type="button"
                  className={styles['rule-expand']}
                  data-advanced-rename-drag-allow="true"
                  aria-expanded={expanded}
                  onClick={() => setExpandedRuleId(expanded ? '' : rule.id)}
                >
                  <span className={styles['rule-kind-icon']}><RuleIcon size={14} aria-hidden="true" /></span>
                  <span className={styles['rule-copy']}>
                    <strong>{t(`files.advancedRename.ruleKind.${choice}`)}</strong>
                    <small>{t(`files.advancedRename.ruleDescription.${choice}`)}</small>
                  </span>
                  <span className={styles['rule-order']}>{index + 1}</span>
                  {diagnostics.length > 0 ? (
                    <Tooltip title={diagnostics.join('\n')}>
                      <span className={styles['rule-error']} aria-label={diagnostics.join('; ')}>
                        <CircleAlert size={13} />
                      </span>
                    </Tooltip>
                  ) : null}
                  <span className={styles['rule-chevron']}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                <div className={styles['rule-controls']} data-advanced-rename-drag-block="true">
                  <Tooltip title={t('files.advancedRename.rules.enabled')} mouseLeaveDelay={0}>
                    <span className={styles['rule-enable']}>
                      <Switch
                        size="small"
                        checked={rule.enabled}
                        disabled={disabled}
                        aria-label={t('files.advancedRename.rules.enabled')}
                        onChange={(enabled) => onUpdateRule({ ...rule, enabled })}
                      />
                    </span>
                  </Tooltip>
                  <div className={styles['rule-actions']}>
                    <IconButton label={t('files.advancedRename.rules.moveUp')} disabled={disabled || index === 0} icon={<ArrowUp size={14} />} onClick={() => onMoveRule(rule.id, index - 1)} />
                    <IconButton label={t('files.advancedRename.rules.moveDown')} disabled={disabled || index === rules.length - 1} icon={<ArrowDown size={14} />} onClick={() => onMoveRule(rule.id, index + 1)} />
                    <IconButton label={t('files.advancedRename.rules.duplicate')} disabled={disabled || rules.length >= advancedRenameRuleLimit} icon={<CopyPlus size={14} />} onClick={() => onDuplicateRule(rule.id)} />
                    <IconButton label={t('app.delete')} disabled={disabled} danger icon={<Trash2 size={14} />} onClick={() => onRemoveRule(rule.id)} />
                  </div>
                </div>
              </header>
              {expanded ? (
                <RuleConfigEditor
                  rule={rule}
                  variableDefinitions={variableDefinitions}
                  disabled={disabled}
                  onChange={onUpdateRule}
                />
              ) : null}
            </article>
          )
        })}
        {rules.length === 0 ? <div className={styles['rules-empty']}>{t('files.advancedRename.rules.empty')}</div> : null}
      </div>

      <section className={styles['variables-section']}>
        <header className={styles['pane-heading']}>
          <span><Variable size={15} aria-hidden="true" />{t('files.advancedRename.variables.title')}</span>
          <Button
            type="text"
            size="small"
            disabled={disabled || variableDefinitions.length >= advancedRenameVariableLimit}
            icon={<Plus size={14} />}
            onClick={addVariable}
          >
            {t('files.advancedRename.variables.add')}
          </Button>
        </header>
        <div className={styles['variable-list']}>
          {variableDefinitions.map((definition, index) => {
            const definitionError = variableDefinitionErrors[index] ?? null
            const invalid = definitionError !== null
            const currentValue = variables[definition.name] ?? definition.default_value
            const requiredMissing = definition.required && !currentValue.trim()
            const validationMessage = definitionError
              ? t(`files.advancedRename.variables.${definitionError === 'duplicate' ? 'duplicateName' : 'invalidName'}`)
              : requiredMissing
                ? t('files.advancedRename.variables.requiredMissing')
                : ''
            const validationId = `advanced-rename-variable-${index}-validation`
            return (
              <div key={index} className={styles['variable-row']}>
                <Input
                  className={styles['variable-name']}
                  value={definition.name}
                  disabled={disabled}
                  status={invalid ? 'error' : undefined}
                  aria-invalid={invalid}
                  aria-describedby={validationMessage ? validationId : undefined}
                  aria-label={t('files.advancedRename.variables.name')}
                  placeholder={t('files.advancedRename.variables.name')}
                  onChange={(event) => updateVariable(index, { name: event.target.value })}
                />
                <Input
                  className={styles['variable-label']}
                  value={definition.label}
                  disabled={disabled}
                  aria-label={t('files.advancedRename.variables.label')}
                  placeholder={t('files.advancedRename.variables.label')}
                  onChange={(event) => updateVariable(index, { label: event.target.value })}
                />
                <Input
                  className={styles['variable-default']}
                  value={definition.default_value}
                  disabled={disabled}
                  aria-label={t('files.advancedRename.variables.defaultValue')}
                  placeholder={t('files.advancedRename.variables.defaultValue')}
                  onChange={(event) => updateVariable(index, { default_value: event.target.value })}
                />
                <Input
                  className={styles['variable-current']}
                  value={currentValue}
                  disabled={disabled || invalid}
                  status={requiredMissing ? 'error' : undefined}
                  aria-label={definition.label || definition.name}
                  placeholder={t('files.advancedRename.variables.value')}
                  onChange={(event) => onVariablesChange({ ...variables, [definition.name]: event.target.value })}
                />
                <Tooltip title={t('files.advancedRename.variables.required')}>
                  <Checkbox
                    checked={definition.required}
                    disabled={disabled}
                    aria-label={t('files.advancedRename.variables.required')}
                    onChange={(event) => updateVariable(index, { required: event.target.checked })}
                  />
                </Tooltip>
                <IconButton label={t('app.delete')} disabled={disabled} danger icon={<Trash2 size={13} />} onClick={() => removeVariable(index)} />
                <Input
                  className={styles['variable-description']}
                  value={definition.description}
                  disabled={disabled}
                  aria-label={t('files.advancedRename.variables.description')}
                  placeholder={t('files.advancedRename.variables.description')}
                  onChange={(event) => updateVariable(index, { description: event.target.value })}
                />
                {validationMessage ? (
                  <small id={validationId} className={styles['variable-validation']} role="alert">
                    {validationMessage}
                  </small>
                ) : null}
              </div>
            )
          })}
          {variableDefinitions.length === 0 ? <small>{t('files.advancedRename.variables.empty')}</small> : null}
        </div>
      </section>
    </section>
  )
}

function IconButton({
  label,
  disabled,
  danger = false,
  icon,
  onClick,
}: {
  label: string
  disabled: boolean
  danger?: boolean
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip title={label} mouseLeaveDelay={0}>
      <Button type="text" size="small" danger={danger} disabled={disabled} aria-label={label} icon={icon} onClick={onClick} />
    </Tooltip>
  )
}
