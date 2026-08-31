import { Button } from 'antd'
import {
  Check,
  ChevronDown,
  Shield,
  ShieldCheck,
  ShieldOff,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog, FilterPopover } from '#shared/ui'
import type { AgentApprovalMode, AgentApprovalPolicyState } from '../model/approvalMode.ts'
import styles from './AgentApprovalModeControl.module.scss'

interface ApprovalModeOption {
  mode: AgentApprovalMode
  icon: LucideIcon
  tone: 'default' | 'warning'
  confirmation?: {
    titleKey: string
    descriptionKey: string
    confirmKey: string
    danger: boolean
  }
}

type ApprovalModeOptionMap = {
  [Mode in AgentApprovalMode]: ApprovalModeOption & { mode: Mode }
}

const approvalModeOptionByMode: ApprovalModeOptionMap = {
  review: {
    mode: 'review',
    icon: ShieldCheck,
    tone: 'default',
  },
  bypass: {
    mode: 'bypass',
    icon: ShieldOff,
    tone: 'warning',
    confirmation: {
      titleKey: 'agent.approvalMode.confirmBypassTitle',
      descriptionKey: 'agent.approvalMode.confirmBypassDescription',
      confirmKey: 'agent.approvalMode.confirmBypass',
      danger: true,
    },
  },
}

const approvalModeOptions: readonly ApprovalModeOption[] = Object.values(approvalModeOptionByMode)

export function AgentApprovalModeControl({
  policy,
  disabled,
  onChange,
}: {
  policy: AgentApprovalPolicyState
  disabled: boolean
  onChange: (mode: AgentApprovalMode) => Promise<void>
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [confirmMode, setConfirmMode] = useState<AgentApprovalMode>()
  const [saving, setSaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const disabledRef = useRef(disabled)
  const policyRef = useRef(policy)
  const savingRef = useRef(false)
  const restoreFocusAfterSaveRef = useRef(false)
  disabledRef.current = disabled
  policyRef.current = policy

  const mode = policy.status === 'ready' ? policy.mode : undefined
  const interactionDisabled = disabled || policy.status === 'unavailable' || saving
  const currentOption = mode ? approvalModeOptionByMode[mode] : undefined
  const confirmOption = confirmMode ? approvalModeOptionByMode[confirmMode] : undefined
  const CurrentIcon = currentOption?.icon ?? Shield
  const label = mode
    ? t(`agent.approvalMode.${mode}`)
    : t('agent.approvalMode.unavailable')
  const restoreTriggerFocus = () => {
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (saving || (!disabled && policy.status === 'ready')) return
    setOpen(false)
    setConfirmMode(undefined)
  }, [disabled, policy.status, saving])

  useEffect(() => {
    if (policy.status === 'ready' && confirmMode === policy.mode) {
      setConfirmMode(undefined)
      if (savingRef.current) restoreFocusAfterSaveRef.current = true
      else if (!disabledRef.current) restoreTriggerFocus()
    }
  }, [confirmMode, policy])

  const commitMode = async (nextMode: AgentApprovalMode) => {
    const currentPolicy = policyRef.current
    if (disabledRef.current || currentPolicy.status !== 'ready' || savingRef.current) return
    if (currentPolicy.mode === nextMode) {
      setOpen(false)
      setConfirmMode(undefined)
      return
    }

    savingRef.current = true
    setSaving(true)
    let restoreFocusAfterSave = false
    try {
      await onChange(nextMode)
      setOpen(false)
      setConfirmMode(undefined)
      restoreFocusAfterSave = true
    } catch {
      // 页面负责展示错误；保留当前菜单或确认窗口，便于用户重试。
    } finally {
      savingRef.current = false
      setSaving(false)
      if (restoreFocusAfterSave || restoreFocusAfterSaveRef.current) {
        restoreFocusAfterSaveRef.current = false
        restoreTriggerFocus()
      }
    }
  }
  const selectMode = (option: ApprovalModeOption) => {
    if (interactionDisabled) return
    if (option.mode === mode) {
      setOpen(false)
      restoreTriggerFocus()
      return
    }
    if (option.confirmation) {
      setOpen(false)
      setConfirmMode(option.mode)
      return
    }
    void commitMode(option.mode)
  }
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      restoreTriggerFocus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'),
    )
    if (options.length === 0) return
    event.preventDefault()
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Home') focusMenuOption(options[0], options)
    else if (event.key === 'End') focusMenuOption(options[options.length - 1], options)
    else {
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const origin = currentIndex >= 0
        ? currentIndex
        : event.key === 'ArrowDown' ? -1 : 0
      const nextIndex = (origin + offset + options.length) % options.length
      focusMenuOption(options[nextIndex], options)
    }
  }
  const menu = (
    <div
      ref={menuRef}
      className={styles.menu}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        setOpen(false)
      }}
      onKeyDown={handleMenuKeyDown}
    >
      <strong id={titleId} className={styles.title}>{t('agent.approvalMode.title')}</strong>
      <div className={styles.options} role="menu" aria-labelledby={titleId}>
        {approvalModeOptions.map((option) => {
          const Icon = option.icon
          const selected = option.mode === mode
          return (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              className={styles.option}
              data-tone={option.tone}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={interactionDisabled}
              onClick={() => selectMode(option)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{t(`agent.approvalMode.${option.mode}`)}</strong>
                <small>{t(`agent.approvalMode.${option.mode}Hint`)}</small>
              </span>
              <Check className={styles.check} size={14} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <>
      <FilterPopover
        open={open}
        placement="topLeft"
        content={menu}
        popupClassName={styles.popover}
        destroyOnHidden
        getPopupContainer={() => document.body}
        onOpenChange={(nextOpen) => {
          if (interactionDisabled) return
          setOpen(nextOpen)
          if (nextOpen) {
            window.requestAnimationFrame(() => {
              const menu = menuRef.current
              const options = Array.from(
                menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
              )
              const selected = options.find((option) => option.getAttribute('aria-checked') === 'true')
              focusMenuOption(selected, options)
            })
          }
        }}
      >
        <Button
          ref={triggerRef}
          type="text"
          className={styles.trigger}
          data-tone={currentOption?.tone}
          aria-label={t('agent.approvalMode.label')}
          aria-description={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={interactionDisabled}
          loading={saving}
          icon={<CurrentIcon size={14} aria-hidden="true" />}
        >
          <span>{label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </Button>
      </FilterPopover>
      <ConfirmDialog
        open={Boolean(confirmOption?.confirmation)
          && policy.status === 'ready'
          && policy.mode !== confirmMode
          && (!disabled || saving)}
        title={confirmOption?.confirmation ? t(confirmOption.confirmation.titleKey) : ''}
        description={confirmOption?.confirmation ? t(confirmOption.confirmation.descriptionKey) : ''}
        confirmLabel={confirmOption?.confirmation ? t(confirmOption.confirmation.confirmKey) : ''}
        danger={confirmOption?.confirmation?.danger}
        confirmLoading={saving}
        onCancel={() => {
          setConfirmMode(undefined)
          restoreTriggerFocus()
        }}
        onConfirm={() => confirmOption && void commitMode(confirmOption.mode)}
      />
    </>
  )
}

function focusMenuOption(
  target: HTMLButtonElement | undefined,
  options: HTMLButtonElement[],
) {
  if (!target) return
  options.forEach((option) => { option.tabIndex = option === target ? 0 : -1 })
  target.focus()
}
