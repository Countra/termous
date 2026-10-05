import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space, Tag } from 'antd'
import { Keyboard, LockKeyhole, RefreshCw } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RemoteClient, type ControlLease, type Session } from '#entities/remote-control'
import type { AppTheme } from '#common/contracts'
import { TerminalInput } from '../model/terminalInput'
import { TerminalOutput } from '../model/terminalOutput'
import { remoteErrorText, type RemoteCopy } from '../model/copy'
import styles from './RemoteTerminal.module.scss'

interface Props { client: RemoteClient; session: Session; copy: RemoteCopy; theme: AppTheme }

export function RemoteTerminal({ client, session, copy, theme }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<TerminalInput | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const lease = useRef<ControlLease | undefined>(undefined)
  const lifetime = useRef<object | undefined>(undefined)
  const [control, setControl] = useState<ControlLease>()
  const [uncertain, setUncertain] = useState(false)
  const [gap, setGap] = useState(false)
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [ended, setEnded] = useState(false)
  const controlled = control?.ownerDeviceId === client.connection.scope.controller_id && !control?.blockedBy

  const applyControl = (value: ControlLease) => {
    lease.current = value
    setControl(value)
    const enabled = value.ownerDeviceId === client.connection.scope.controller_id && !value.blockedBy
    input.current?.update(value.generation, value.acceptedSequence, enabled, value.uncertain)
    if (terminal.current) terminal.current.options.disableStdin = !enabled || value.uncertain
  }

  const act = async (action: string) => {
    const current = lifetime.current
    if (!current || busy) return
    setBusy(true); setError(undefined)
    try {
      const result = await client.request({ operation: { case: 'session', value: { sessionId: session.id, generation: session.generation, action, controlGeneration: action === 'control_acquire' ? 0n : lease.current?.generation ?? 0n } } })
      if (lifetime.current !== current) {
        // 关闭视图可能先于授予回执；按旧代次释放，不能让无人使用的输入权继续续租。
        if (action === 'control_acquire' && result.result.case === 'control' && result.result.value.ownerDeviceId === client.connection.scope.controller_id) {
          await client.request({ operation: { case: 'session', value: { sessionId: session.id, generation: session.generation, action: 'control_release', controlGeneration: result.result.value.generation } } })
        }
        return
      }
      if (result.result.case === 'control') applyControl(result.result.value)
      if (action === 'control_acquire' && terminal.current && result.result.case === 'control') {
        await client.request({ operation: { case: 'session', value: { sessionId: session.id, generation: session.generation, action: 'resize', controlGeneration: result.result.value.generation, columns: terminal.current.cols, rows: terminal.current.rows } } })
      }
    } catch (reason) {
      if (lifetime.current === current) setError(reason)
      else if (action === 'control_acquire') console.warn('[termous:remote] 视图退出后的输入权回收未确认，将由连接关闭或租约到期收回')
    } finally { if (lifetime.current === current) setBusy(false) }
  }

  useEffect(() => {
    const element = container.current
    if (!element) return
    const current = {}
    lifetime.current = current
    let active = true
    let outputEnded = false
    let unstream: (() => void) | undefined
    let activeStream = ''
    let lastSequence = 0n
    const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace', scrollback: 5000, disableStdin: true, allowProposedApi: false, theme: { background: theme === 'dark' ? '#0f1116' : '#f4f5f7', foreground: theme === 'dark' ? '#e4e9f1' : '#202734' } })
    const fit = new FitAddon()
    term.loadAddon(fit); term.open(element); fit.fit(); terminal.current = term
    // 远端输出不得触发剪贴板或外部导航；终端仅按文本展示超链接。
    const clipboard = term.parser.registerOscHandler(52, () => true)
    const links = term.parser.registerOscHandler(8, () => true)
    const writer = new TerminalInput(async (data, generation, sequence) => {
      await client.send({ streamId: activeStream, kind: 'terminal_input', data, controlGeneration: generation, sequence })
    }, frozen => { if (active) { setUncertain(frozen); term.options.disableStdin = frozen || lease.current?.ownerDeviceId !== client.connection.scope.controller_id || Boolean(lease.current?.blockedBy) } })
    input.current = writer
    const finishOutput = () => {
      outputEnded = true; lifetime.current = undefined; lease.current = undefined
      setControl(undefined); setBusy(false); setEnded(true); writer.dispose(); term.options.disableStdin = true
    }
    const output = new TerminalOutput((data, done) => term.write(data, done), bytes => client.send({ streamId: activeStream, kind: 'credit', credit: BigInt(bytes) }), reason => {
      if (!active) return
      finishOutput(); setError(reason)
      unstream?.()
      void client.request({ operation: { case: 'session', value: { action: 'detach', sessionId: session.id, generation: session.generation, streamId: activeStream } } }).catch(error => { if (active) setError(error) })
    })
    const typing = term.onData(text => writer.push(new TextEncoder().encode(text)))
    let resizeTimer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!active || outputEnded) return
        fit.fit()
        if (lease.current?.ownerDeviceId === client.connection.scope.controller_id && !lease.current.blockedBy) {
          void client.request({ operation: { case: 'session', value: { sessionId: session.id, generation: session.generation, action: 'resize', controlGeneration: lease.current.generation, columns: term.cols, rows: term.rows } } }).catch(reason => { if (active) setError(reason) })
        }
      }, 120)
    })
    observer.observe(element)
    const unlisten = client.onEvent(event => {
      if (!active || outputEnded) return
      if (event.value.case === 'attachment' && event.value.value.streamId === activeStream && event.value.value.gap) setGap(true)
      if (event.value.case === 'session' && event.value.value.id === session.id) {
        if (event.type === 'input_rejected') { writer.freeze(); setError({ code: event.value.value.errorCode }) }
        if (event.value.value.control && event.value.value.control.ownerDeviceId !== client.connection.scope.controller_id) applyControl(event.value.value.control)
      }
    })
    void (async () => {
      const response = await client.request({ operation: { case: 'session', value: { action: 'attach', sessionId: session.id, generation: session.generation } } })
      if (response.result.case !== 'attachment') throw new Error('remote_attachment_invalid')
      const attachment = response.result.value
      activeStream = attachment.streamId
      if (!active) { await client.request({ operation: { case: 'session', value: { action: 'detach', sessionId: session.id, generation: session.generation, streamId: activeStream } } }); return }
      setGap(Boolean(attachment.gap))
      unstream = client.stream(activeStream, async frame => {
        if (!active || outputEnded) return
        if (frame.kind === 'ack') { writer.acknowledge(frame.controlGeneration, frame.sequence); return }
        if (frame.kind !== 'terminal_output') return
        if (frame.sequence <= lastSequence) return
        if (frame.sequence !== lastSequence + 1n) setGap(true)
        lastSequence = frame.sequence
        if (frame.end) { finishOutput(); output.dispose(); return }
        await output.consume(frame.data)
      })
      if (!await output.start() || !active || outputEnded) return
      const state = await client.request({ operation: { case: 'session', value: { action: 'control_status', sessionId: session.id, generation: session.generation } } })
      if (active && !outputEnded && state.result.case === 'control') applyControl(state.result.value)
    })().catch(reason => { if (active) setError(reason) })
    return () => {
      if (lifetime.current === current) lifetime.current = undefined
      active = false; clearTimeout(resizeTimer); observer.disconnect(); typing.dispose(); clipboard.dispose(); links.dispose(); unstream?.(); unlisten(); output.dispose(); writer.dispose(); term.dispose(); terminal.current = null; input.current = null
      if (activeStream) void client.request({ operation: { case: 'session', value: { action: 'detach', sessionId: session.id, generation: session.generation, streamId: activeStream } } }).catch(() => { console.warn('[termous:remote] 视图释放未确认，输入权将由连接关闭或租约到期收回') })
    }
    // 每个附着独立持有输出与输入队列；主题更新在下方执行，不重建 SSH 会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session.id, session.generation])

  useEffect(() => { if (terminal.current) terminal.current.options.theme = { background: theme === 'dark' ? '#0f1116' : '#f4f5f7', foreground: theme === 'dark' ? '#e4e9f1' : '#202734' } }, [theme])

  return <div className={styles.terminal}>
    <div className={styles.toolbar}><Tag icon={controlled && !ended ? <Keyboard size={13} /> : <LockKeyhole size={13} />} color={controlled && !ended ? 'blue' : undefined}>{controlled && !ended ? copy.controlling : copy.readOnly}</Tag><Space><Button size="small" loading={busy} disabled={ended} onClick={() => void act(controlled ? 'control_release' : 'control_acquire')}>{controlled ? copy.releaseControl : copy.takeControl}</Button><Button size="small" disabled={ended} icon={<RefreshCw size={14} />} aria-label={copy.inputStatus} onClick={() => void act('control_status')} /></Space></div>
    {error ? <Alert type="warning" showIcon title={remoteErrorText(copy, error)} closable onClose={() => setError(undefined)} /> : null}
    {gap ? <Alert type="info" title={copy.gap} closable onClose={() => setGap(false)} /> : null}
    {uncertain ? <Alert type="warning" title={copy.inputUncertain} /> : null}
    <div ref={container} className={styles.viewport} />
  </div>
}
