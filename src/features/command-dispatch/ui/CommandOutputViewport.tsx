import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppTheme, TerminalSettings } from '#common/contracts'
import {
  commandDispatchOutputTheme,
} from '../model/commandDispatchOutputRender'
import { CommandDispatchOutputWriter } from '../model/commandDispatchOutputWriter'
import { useCommandDispatchTargetOutput } from '../runtime/commandDispatchContext'
import styles from './CommandOutputViewport.module.scss'

interface CommandOutputViewportProps {
  taskId?: string
  sessionId?: string
  terminalSettings: TerminalSettings
  appTheme: AppTheme
}

export function CommandOutputViewport({
  taskId,
  sessionId,
  terminalSettings,
  appTheme,
}: CommandOutputViewportProps) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const outputWriterRef = useRef<CommandDispatchOutputWriter | null>(null)
  const terminalSettingsRef = useRef(terminalSettings)
  const appThemeRef = useRef(appTheme)
  terminalSettingsRef.current = terminalSettings
  appThemeRef.current = appTheme
  const output = useCommandDispatchTargetOutput(taskId, sessionId)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const initialSettings = terminalSettingsRef.current
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: terminalFontFamily(),
      fontSize: Math.max(11, initialSettings.font_size - 1),
      lineHeight: initialSettings.line_height,
      letterSpacing: initialSettings.letter_spacing,
      scrollback: initialSettings.scrollback,
      theme: commandDispatchOutputTheme(initialSettings, appThemeRef.current),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit
    outputWriterRef.current = new CommandDispatchOutputWriter(terminal)
    const resize = () => {
      try {
        fit.fit()
      } catch {
        // Dock 折叠动画中的零尺寸由下一次 ResizeObserver 回调恢复。
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    const frame = window.requestAnimationFrame(resize)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      outputWriterRef.current?.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      outputWriterRef.current = null
    }
  }, [sessionId, taskId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.fontFamily = terminalFontFamily()
    terminal.options.fontSize = Math.max(11, terminalSettings.font_size - 1)
    terminal.options.lineHeight = terminalSettings.line_height
    terminal.options.letterSpacing = terminalSettings.letter_spacing
    terminal.options.scrollback = terminalSettings.scrollback
    terminal.options.theme = commandDispatchOutputTheme(terminalSettings, appTheme)
    try {
      fitRef.current?.fit()
    } catch {
      // 宿主尚未完成布局时由 ResizeObserver 再次调整。
    }
  }, [appTheme, terminalSettings])

  useEffect(() => {
    if (output.revision === 0) return
    outputWriterRef.current?.update(output)
  }, [output])

  return (
    <div
      ref={hostRef}
      className={styles.root}
      data-command-dispatch-output=""
      aria-label={t('commandDispatch.ptyOutput')}
    />
  )
}

function terminalFontFamily() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--terminal-font-family')
    .trim() || 'ui-monospace, SFMono-Regular, Consolas, monospace'
}
