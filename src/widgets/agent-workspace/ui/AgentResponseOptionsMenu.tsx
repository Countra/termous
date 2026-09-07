import {
  AlertTriangle,
  ChevronRight,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import { Button, Popover } from 'antd'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentReasoningLevel } from '#entities/agent'
import type { AgentWorkspaceModelOption } from '../model/types.ts'
import { AgentModelPickerPane } from './AgentModelPickerPane.tsx'
import { AgentReasoningPickerPane } from './AgentReasoningPickerPane.tsx'
import styles from './AgentResponseOptionsMenu.module.scss'

type OptionsPane = 'model' | 'reasoning'

export function AgentResponseOptionsMenu({
  models,
  selectedModelId,
  fallbackModelName,
  fallbackModelAlias,
  fallbackProviderName,
  selectedReasoningLevel,
  supportedReasoningLevels,
  defaultModelId,
  modelSelectionDisabled,
  reasoningSelectionDisabled,
  onModelChange,
  onReasoningChange,
  onReset,
  onOpenSettings,
}: {
  models: AgentWorkspaceModelOption[]
  selectedModelId?: string
  fallbackModelName?: string
  fallbackModelAlias?: string
  fallbackProviderName?: string
  selectedReasoningLevel: AgentReasoningLevel
  supportedReasoningLevels: AgentReasoningLevel[]
  defaultModelId?: string
  modelSelectionDisabled: boolean
  reasoningSelectionDisabled: boolean
  onModelChange: (modelId: string) => void
  onReasoningChange: (reasoningLevel: AgentReasoningLevel) => void
  onReset: () => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<OptionsPane>()
  const paneRef = useRef<HTMLDivElement>(null)
  const modelRowRef = useRef<HTMLButtonElement>(null)
  const reasoningRowRef = useRef<HTMLButtonElement>(null)
  const selectedModel = models.find((model) => model.id === selectedModelId)
  const defaultModel = models.find((model) => model.id === defaultModelId && model.runnable)
  const hasModelContext = models.length > 0 || Boolean(selectedModelId)
  const hasRunnableModel = models.some((model) => model.runnable)
  const modelUnavailable = Boolean(selectedModelId && (!selectedModel || !selectedModel.runnable))
  const requiresConfiguration = !selectedModelId && !hasRunnableModel
  const selectedModelLabel = selectedModel?.remote_model_id
    || fallbackModelName
    || t('agent.header.selectModel')
  const selectedReasoningLabel = t(`settings.agent.reasoning.${selectedReasoningLevel}`)
  const resetDisabled = modelSelectionDisabled
    || !defaultModel
    || (
      selectedModelId === defaultModel.id
      && selectedReasoningLevel === defaultModel.effective_default_reasoning_level
    )
  const paneLabel = pane === 'model'
    ? t('agent.header.model')
    : t('agent.composer.reasoning')
  const triggerSummary = useMemo(
    () => `${selectedModelLabel} · ${selectedReasoningLabel}`,
    [selectedModelLabel, selectedReasoningLabel],
  )

  useEffect(() => {
    if (!modelSelectionDisabled) return
    setOpen(false)
    setPane(undefined)
  }, [modelSelectionDisabled])

  const close = () => {
    setOpen(false)
    setPane(undefined)
  }
  const openPane = (nextPane: OptionsPane, focusPane = false) => {
    setPane(nextPane)
    if (!focusPane) return
    window.requestAnimationFrame(() => {
      paneRef.current
        ?.querySelector<HTMLElement>('[data-pane-focus]:not(:disabled)')
        ?.focus()
    })
  }
  const returnToRoot = () => {
    const previousPane = pane
    setPane(undefined)
    window.requestAnimationFrame(() => {
      if (previousPane === 'model') modelRowRef.current?.focus()
      if (previousPane === 'reasoning') reasoningRowRef.current?.focus()
    })
  }
  const handlePaneKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'Escape') return
    if (event.key === 'ArrowLeft' && isTextEditingTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    returnToRoot()
  }

  if (!hasModelContext) {
    return (
      <Button
        type="text"
        className={styles['configure-trigger']}
        icon={<Settings2 size={14} aria-hidden="true" />}
        onClick={onOpenSettings}
      >
        {t('agent.header.configureProvider')}
      </Button>
    )
  }

  return (
    <Popover
      open={open}
      trigger="click"
      placement="topRight"
      arrow={false}
      destroyOnHidden
      content={(
        <div className={styles.shell} onClick={(event) => event.stopPropagation()}>
          <div className={`${styles.surface} ${styles.root}`} role="menu" aria-label={t('agent.composer.responseOptions')}>
            <MenuRow
              buttonRef={modelRowRef}
              label={t('agent.header.model')}
              value={selectedModelLabel}
              warning={modelUnavailable || requiresConfiguration}
              active={pane === 'model'}
              disabled={modelSelectionDisabled}
              onOpen={() => openPane('model')}
              onKeyboardOpen={() => openPane('model', true)}
            />
            <MenuRow
              buttonRef={reasoningRowRef}
              label={t('agent.composer.reasoning')}
              value={selectedReasoningLabel}
              active={pane === 'reasoning'}
              disabled={reasoningSelectionDisabled}
              onOpen={() => openPane('reasoning')}
              onKeyboardOpen={() => openPane('reasoning', true)}
            />
            <div className={styles.divider} role="separator" />
            <button
              type="button"
              role="menuitem"
              className={`${styles.row} ${styles['reset-row']}`}
              disabled={resetDisabled}
              onClick={() => {
                onReset()
                close()
              }}
            >
              <span>{t('agent.composer.resetResponseOptions')}</span>
              <RotateCcw size={13} aria-hidden="true" />
            </button>
            {modelUnavailable || requiresConfiguration ? (
              <button
                type="button"
                role="menuitem"
                className={`${styles.row} ${styles['settings-row']}`}
                onClick={() => {
                  close()
                  onOpenSettings()
                }}
              >
                <span>{t('agent.header.configureProvider')}</span>
                <Settings2 size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {pane ? (
            <div
              ref={paneRef}
              className={`${styles.surface} ${styles.pane}`}
              role="presentation"
              aria-label={paneLabel}
              onKeyDown={handlePaneKeyDown}
            >
              {pane === 'model' ? (
                <AgentModelPickerPane
                  models={models}
                  selectedModelId={selectedModelId}
                  fallbackName={fallbackModelName}
                  fallbackDisplayName={fallbackModelAlias}
                  fallbackProviderName={fallbackProviderName}
                  onBack={returnToRoot}
                  onChange={(modelId) => {
                    onModelChange(modelId)
                    close()
                  }}
                />
              ) : (
                <AgentReasoningPickerPane
                  value={selectedReasoningLevel}
                  levels={supportedReasoningLevels}
                  onBack={returnToRoot}
                  onChange={(reasoningLevel) => {
                    onReasoningChange(reasoningLevel)
                    close()
                  }}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
      classNames={{ root: styles.popover }}
      getPopupContainer={() => document.body}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPane(undefined)
      }}
    >
      <Button
        type="text"
        className={styles.trigger}
        data-unavailable={modelUnavailable ? 'true' : undefined}
        disabled={modelSelectionDisabled}
        aria-label={t('agent.composer.responseOptions')}
        aria-description={triggerSummary}
        aria-expanded={open}
        icon={modelUnavailable
          ? <AlertTriangle size={13} aria-hidden="true" />
          : <SlidersHorizontal size={13} aria-hidden="true" />}
      >
        <span className={styles['trigger-model']}>{selectedModelLabel}</span>
        <span className={styles['trigger-separator']} aria-hidden="true">·</span>
        <span className={styles['trigger-reasoning']}>{selectedReasoningLabel}</span>
      </Button>
    </Popover>
  )
}

function MenuRow({
  buttonRef,
  label,
  value,
  warning = false,
  active,
  disabled,
  onOpen,
  onKeyboardOpen,
}: {
  buttonRef: Ref<HTMLButtonElement>
  label: string
  value: string
  warning?: boolean
  active: boolean
  disabled: boolean
  onOpen: () => void
  onKeyboardOpen: () => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      className={styles.row}
      data-active={active ? 'true' : undefined}
      data-warning={warning ? 'true' : undefined}
      disabled={disabled}
      aria-label={label}
      aria-description={value}
      aria-expanded={active}
      aria-haspopup="menu"
      onMouseEnter={onOpen}
      onFocus={onOpen}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight') return
        event.preventDefault()
        onKeyboardOpen()
      }}
    >
      <span className={styles['row-label']}>{label}</span>
      <span className={styles['row-value']}>{value}</span>
      <ChevronRight size={13} aria-hidden="true" />
    </button>
  )
}

function isTextEditingTarget(target: EventTarget) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable)
}
