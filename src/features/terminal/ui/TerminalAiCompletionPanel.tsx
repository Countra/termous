import { ArrowUp, Bot, Check, Copy, CornerDownLeft, LoaderCircle, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppTheme } from '#common/contracts'
import { agentDefaultModelReasonKey, type AgentDefaultModelStatusView } from '#entities/agent'
import type { TerminalCompletionPopupPosition } from '../model/terminalCompletionPosition.ts'
import {
  TERMINAL_AI_COMPLETION_POPUP_WIDTH, TERMINAL_AI_COMPLETION_HEADER_HEIGHT,
  TERMINAL_AI_COMPLETION_CHROME_HEIGHT,
} from '../model/terminalAiCompletion.ts'
import popupStyles from './TerminalCompletionPopup.module.scss'
import styles from './TerminalAiCompletionPanel.module.scss'
import { TerminalAiCompletionList, type TerminalAiCompletionCandidate } from './TerminalAiCompletionList.tsx'

export interface TerminalAiCompletionPanelProps {
  id?: string
  open: boolean
  position: TerminalCompletionPopupPosition | null
  themeMode: AppTheme
  prompt: string
  onPromptChange: (prompt: string) => void
  state: 'idle' | 'loading' | 'ready' | 'error'
  model: AgentDefaultModelStatusView
  results: readonly TerminalAiCompletionCandidate[]
  selectedResultId: string | null
  onSelectResult: (requestId: string) => void
  errorMessage?: string
  appendState: 'append' | 'mismatch' | 'exact' | 'stale'
  onGenerate: () => void
  onCancel: () => void
  onAppend: () => void
  onCopy: () => void | Promise<void>
  onClose: () => void
  onOpenSettings: () => void
}

export function TerminalAiCompletionPanel({
  id, open, position, themeMode, prompt, onPromptChange, state, model, results, selectedResultId, onSelectResult,
  errorMessage, appendState, onGenerate, onCancel, onAppend, onCopy, onClose, onOpenSettings,
}: TerminalAiCompletionPanelProps) {
  const { t } = useTranslation()
  const generatedId = useId()
  const panelId = id ?? `terminal-ai-${generatedId}`
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const previousResultCount = useRef(results.length)
  const composing = useRef(false)
  const copyOperation = useRef(0)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const loading = state === 'loading'
  const hasPosition = position !== null
  const selectedResult = results.find((result) => result.requestId === selectedResultId)
  const canGenerate = model.status === 'ready' && !loading && Boolean(prompt.trim())
  const inputMaxHeight = Math.max(28, Math.min(76, (position?.maxHeight ?? 320) - TERMINAL_AI_COMPLETION_CHROME_HEIGHT))
  const modelLabel = selectedResult?.model?.name ?? (model.status === 'loading'
    ? t('terminal.aiCompletion.modelLoading') : model.label ?? t('terminal.aiCompletion.modelUnset'))

  useEffect(() => {
    if (open && hasPosition) inputRef.current?.focus()
    if (!open) composing.current = false
  }, [open, hasPosition])

  useEffect(() => {
    const appended = results.length > previousResultCount.current
    previousResultCount.current = results.length
    // 只接续需求区内的生成操作；用户浏览旧候选时不移动焦点或覆盖选择。
    if (open && appended && results[results.length - 1]?.requestId === selectedResultId
      && composerRef.current?.contains(document.activeElement)) listRef.current?.focus()
  }, [open, results, selectedResultId])

  useEffect(() => {
    setCopyState('idle')
    return () => { copyOperation.current += 1 }
  }, [open, selectedResultId])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!open || !hasPosition || !input) return
    // 单行起步，换行和窄分屏时按内容增高；长需求仍在输入框内滚动。
    const resize = () => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(inputMaxHeight, input.scrollHeight)}px`
    }
    resize()
    let previousWidth = 0
    let resizeFrame: number | null = null
    // 只响应宽度变化，并在下一帧调整高度，避免在尺寸通知内再次改变被观察元素。
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === previousWidth) return
      previousWidth = entry.contentRect.width
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        resize()
      })
    })
    if (input.parentElement) observer.observe(input.parentElement)
    return () => {
      observer.disconnect()
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
    }
  }, [open, hasPosition, inputMaxHeight, prompt])

  if (!open || !position) return null

  const generateLabel = t(loading ? 'terminal.aiCompletion.cancel' : state === 'error' ? 'terminal.aiCompletion.retry'
    : results.length > 0 ? 'terminal.aiCompletion.generateMore' : 'terminal.aiCompletion.generate')
  const copyLabel = t(copyState === 'copied' ? 'terminal.aiCompletion.copied' : 'terminal.aiCompletion.copy')
  const appendLabel = t(appendState === 'exact' ? 'terminal.aiCompletion.alreadyEntered' : 'terminal.aiCompletion.append')

  const copy = async () => {
    if (!selectedResult || copyState === 'copying') return
    const operation = ++copyOperation.current
    setCopyState('copying')
    try {
      await onCopy()
      if (copyOperation.current === operation) setCopyState('copied')
    } catch {
      if (copyOperation.current === operation) setCopyState('failed')
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
      event.preventDefault()
      onClose()
    }
    if (event.key !== 'Tab') return
    const targets = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(':is(button, textarea, [tabindex]):not(:disabled)') ?? [])
      .filter((target) => target.tabIndex >= 0)
    if (!targets?.length) return
    const index = targets.findIndex((target) => target === document.activeElement)
    event.preventDefault()
    targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus()
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229
      || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canGenerate) onGenerate()
      return
    }
    const input = event.currentTarget
    if (!event.shiftKey && results.length > 0 && input.selectionStart === input.selectionEnd
      && ((event.key === 'ArrowDown' && input.selectionEnd === input.value.length)
        || (event.key === 'ArrowUp' && input.selectionStart === 0))) {
      event.preventDefault()
      listRef.current?.focus()
    }
  }

  return (
    <section
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-modal="false"
      aria-label={t('terminal.aiCompletion.title')}
      data-terminal-ai-completion=""
      className={`${popupStyles['terminal-completion-popup']} ${popupStyles[`terminal-completion-theme-${themeMode}`]} ${styles.panel}`}
      data-placement={position.placement}
      style={{
        left: position.left,
        top: position.top + (position.placement === 'above' ? position.maxHeight : 0),
        width: Math.min(TERMINAL_AI_COMPLETION_POPUP_WIDTH, position.maxWidth),
        maxHeight: position.maxHeight,
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className={styles.header} style={{ height: TERMINAL_AI_COMPLETION_HEADER_HEIGHT }}>
        <span className={styles.heading}><Bot size={14} aria-hidden="true" />{t('terminal.aiCompletion.title')}</span>
        <span className={styles.model} title={modelLabel}>{modelLabel}</span>
      </header>
      <div ref={composerRef} className={styles.composer}>
        <div className={styles['input-row']}>
          <span className={styles['model-icon']}>
            {loading ? <LoaderCircle className={styles.spinner} size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          </span>
          <textarea
            ref={inputRef}
            id={`${panelId}-prompt`}
            className={styles.input}
            style={{ maxHeight: inputMaxHeight }}
            rows={1}
            value={prompt}
            maxLength={4096}
            readOnly={loading}
            aria-label={t('terminal.aiCompletion.prompt')}
            aria-describedby={`${panelId}-input-hint`}
            title={t('terminal.aiCompletion.inputHint')}
            placeholder={t('terminal.aiCompletion.placeholder')}
            onChange={(event) => onPromptChange(event.target.value)}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
            onKeyDown={handlePromptKeyDown}
          />
          <button
            type="button"
            className={`${styles['icon-button']} ${styles.generate}`}
            aria-label={generateLabel}
            title={generateLabel}
            disabled={!loading && !canGenerate}
            onClick={loading ? onCancel : onGenerate}
          >
            {loading ? <Square size={12} aria-hidden="true" /> : state === 'error' ? <RotateCcw size={14} aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}
          </button>
        </div>
        <button type="button" className={styles['icon-button']} aria-label={t('terminal.aiCompletion.close')} title={t('terminal.aiCompletion.close')} onClick={onClose}><X size={14} aria-hidden="true" /></button>
      </div>
      <span id={`${panelId}-input-hint`} className={styles.announcement}>{t('terminal.aiCompletion.inputHint')}</span>
      <span className={styles.announcement} role="status">{loading ? t('terminal.aiCompletion.generating') : ''}</span>
      <div ref={bodyRef} className={styles.body}>
        {model.status === 'unavailable' ? (
          <div className={styles.unavailable}>
            <span>{t(agentDefaultModelReasonKey(model.reason))}</span>
            <button type="button" className={styles.link} onClick={onOpenSettings}>{t('terminal.aiCompletion.openSettings')}</button>
          </div>
        ) : null}
        {state === 'error' && errorMessage ? <p className={`${styles.error} ${styles['request-error']}`} role="status" tabIndex={0}>{errorMessage}</p> : null}
        {results.length > 0 ? (
          <div className={styles.results}>
            <TerminalAiCompletionList
              id={`${panelId}-candidates`}
              listRef={listRef}
              viewportRef={bodyRef}
              results={results}
              selectedResultId={selectedResultId}
              onSelectResult={onSelectResult}
              canAppend={Boolean(selectedResult) && appendState === 'append'}
              onAppend={onAppend}
            />
            <span id={`${panelId}-candidates-hint`} className={styles.announcement}>{t('terminal.aiCompletion.listHint')}</span>
            <footer className={styles.details}>
              <div className={styles['description-row']}>
                <p className={styles.description} tabIndex={0}>{selectedResult?.description}</p>
                <button type="button" className={styles['icon-button']} disabled={!selectedResult || copyState === 'copying'} aria-label={copyLabel} title={copyLabel} onClick={() => void copy()}>
                  {copyState === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                </button>
                <button type="button" className={`${styles['icon-button']} ${styles.insert}`} disabled={!selectedResult || appendState !== 'append'} aria-label={appendLabel} title={`${appendLabel} · Enter`} onClick={onAppend}>
                  <CornerDownLeft size={14} aria-hidden="true" />
                </button>
              </div>
              {appendState !== 'append' ? <p className={styles.hint}>{t(`terminal.aiCompletion.appendHint.${appendState}`)}</p> : null}
              {copyState === 'failed' ? <p className={styles.error} role="status">{t('terminal.aiCompletion.copyFailed')}</p> : null}
              <span className={styles.announcement} role="status">{copyState === 'copied' ? t('terminal.aiCompletion.copied') : ''}</span>
            </footer>
          </div>
        ) : null}
      </div>
    </section>
  )
}
