import { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Input, Modal, Popconfirm, Select, Spin, Tag, Tooltip } from 'antd'
import { Clipboard, Keyboard, Maximize, Monitor, RotateCcw, ShieldCheck, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RemoteDesktopSession, type DesktopSessionEvents, type DesktopState } from '@termous/remote-protocol/desktop'
import type { RemoteClient, Session } from '#entities/remote-control'
import { termousPopconfirmProps } from '#shared/ui'
import { bindDesktopInput } from '../model/desktopInput'
import { desktopCopy, desktopErrorText } from '../model/desktopCopy'
import styles from './RemoteDesktop.module.scss'
import { DesktopCursorOverlay } from './DesktopCursorOverlay'
import { type CursorState, updateCursor } from '../model/desktopCursor'

type Challenge = Parameters<DesktopSessionEvents['challenge']>[0]
type Reply = Awaited<ReturnType<DesktopSessionEvents['challenge']>>

export function RemoteDesktop({ client, session, active }: { client: RemoteClient; session: Session; active: boolean }) {
  const { i18n } = useTranslation()
  const copy = desktopCopy(i18n.language?.startsWith('zh') ?? false)
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  const runtime = useRef<RemoteDesktopSession>(undefined)
  const closing = useRef(Promise.resolve())
  const replaceNext = useRef(false)
  const pending = useRef(false)
  const reply = useRef<((value: Reply) => void) | undefined>(undefined)
  const [cursor, setCursor] = useState<CursorState>()
  const [challenge, setChallenge] = useState<Challenge>()
  const [password, setPassword] = useState(''), [username, setUsername] = useState('')
  const [phase, setPhase] = useState('idle'), [error, setError] = useState(''), [state, setState] = useState<DesktopState>()
  const [attempt, setAttempt] = useState(0), [joined, setJoined] = useState(session.engine !== 'vnc')
  const [working, setWorking] = useState(false), [fit, setFit] = useState(true), [tool, setTool] = useState<'text' | 'clipboard'>()
  const [text, setText] = useState(''), [remoteClipboard, setRemoteClipboard] = useState(''), [path, setPath] = useState('—')
  const targetReady = session.generation > 0n && !['failed', 'stopping'].includes(session.state)
  const running = joined && targetReady && (session.engine === 'vnc' || active)
  useEffect(() => {
    if (!running || !canvas.current || !video.current) { setPhase('idle'); setChallenge(undefined); return }
    let alive = true
    const view = new RemoteDesktopSession({ request: value => client.desktop(value), ice: () => client.desktopICE() }, session.id, session.generation, {
      state: value => { if (alive) setState(value) },
      status: (phase, reason) => { if (alive) { setPhase(phase); setError(reason ?? ''); if (phase === 'closed') { reply.current?.({ accept: false }); reply.current = undefined; setChallenge(undefined); setPassword(''); setUsername('') }; if (reason === 'desktop_display_changed') setAttempt(value => value + 1) } },
      clipboard: value => { if (alive) setRemoteClipboard(value) },
      network: value => { if (alive) setPath(value) },
      cursor: value => { if (alive) setCursor(previous => updateCursor(previous, value)) },
      challenge: challenge => new Promise(resolve => { if (!alive) { resolve({ accept: false }); return }; reply.current?.({ accept: false }); const timer = setTimeout(() => { reply.current = undefined; setChallenge(undefined); resolve({ accept: false }) }, 90_000); reply.current = value => { clearTimeout(timer); resolve(value) }; setPassword(''); setUsername(''); setChallenge(challenge) }),
    })
    runtime.current = view
    pending.current = false
    setWorking(false); setPhase('connecting'); setChallenge(undefined); setPassword(''); setUsername('')
    setState(undefined); setCursor(undefined); setError(''); setPath('—')
    const unbind = bindDesktopInput(video.current, view, () => { view.close(); setPhase('closed'); setError('desktop_input_uncertain') })
    const target = canvas.current, player = video.current
    // 接替仅对本次明确操作生效；等待旧附着撤销，避免重连与自身争抢席位。
    const replace = replaceNext.current
    replaceNext.current = false
    void closing.current.then(() => { if (alive) return view.start(target, player, replace) })
    return () => { alive = false; reply.current?.({ accept: false }); reply.current = undefined; unbind(); closing.current = closing.current.then(() => view.close()); runtime.current = undefined }
  }, [client, session.id, session.generation, running, attempt])
  const act = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    const view = runtime.current
    pending.current = true
    setWorking(true); setError('')
    try { await action() } catch (error) { if (runtime.current === view) setError(error instanceof Error ? error.message : 'desktop_operation_failed') } finally { if (runtime.current === view) { pending.current = false; setWorking(false) } }
  }
  const answer = (accept: boolean) => { const respond = reply.current; reply.current = undefined; setChallenge(undefined); respond?.({ accept, password, username }); setPassword(''); setUsername('') }
  const owned = running && phase === 'viewing' && runtime.current?.owned === true
  const status = phase === 'viewing' ? owned ? copy.control : state?.control ? ['local', 'local-viewer'].includes(state.control.owner) ? copy.local : copy.other : copy.watching : phase === 'closed' ? copy.failed : !running ? copy.paused : phase === 'recovering' ? copy.recovering : copy.connecting
  const errorText = desktopErrorText(error, copy)
  const errorCode = /^(?:desktop|remote|rdp)_[a-z0-9_]{1,80}$/.test(error) ? error : 'desktop_operation_failed'
  const certificate = challenge && (challenge.kind === 'certificate' || challenge.kind === 'vnc_certificate' || challenge.kind === 'ssh_certificate')
  return <div className={styles.desktop} ref={root}>
    <div className={styles.toolbar}>
      <div className={styles.identity}><Monitor size={15} /><Tag>{session.engine.toUpperCase()}</Tag><span role="status">{status}</span></div>
      <div className={styles.actions}>
        <Button size="small" disabled={phase !== 'viewing' || working} loading={working} onClick={() => void act(() => owned ? runtime.current!.release() : runtime.current!.acquire(true))}>{owned ? copy.release : copy.take}</Button>
        <Select size="small" value={fit ? 'fit' : 'actual'} aria-label={copy.fit} options={[{ value: 'fit', label: copy.fit }, { value: 'actual', label: copy.actual }]} onChange={mode => { setFit(mode === 'fit'); runtime.current?.display(mode === 'fit') }} />
        <Tooltip title={copy.keyboard}><Button size="small" type="text" disabled={!owned} icon={<Keyboard size={16} />} aria-label={copy.keyboard} onClick={() => { setText(''); setTool('text') }} /></Tooltip>
        <Tooltip title={copy.clipboard}><Button size="small" type="text" disabled={!owned} icon={<Clipboard size={16} />} aria-label={copy.clipboard} onClick={() => { setText(remoteClipboard); setTool('clipboard') }} /></Tooltip>
        {session.engine === 'rdp' && state?.capabilities.includes('resize') ? <Dropdown menu={{ items: [{ key: '1280x720', label: '1280 × 720' }, { key: '1920x1080', label: '1920 × 1080' }], onClick: ({ key }) => void act(async () => { const [width, height] = key.split('x').map(Number); runtime.current?.input({ kind: 'resize', width, height }) }) }}><Button type="text" size="small" aria-label={copy.resize} disabled={!owned || working} icon={<Settings2 size={16} />} /></Dropdown> : null}
        <Tooltip title={copy.fullscreen}><Button size="small" type="text" icon={<Maximize size={16} />} aria-label={copy.fullscreen} onClick={() => void act(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen() })} /></Tooltip>
      </div>
    </div>
    {error && phase !== 'closed' ? <div className={styles.notice} role="alert">{errorText}</div> : null}
    <div className={styles.surface}>
      <div ref={canvas} className={styles.canvas} hidden={session.engine !== 'vnc'} />
      <video ref={video} className={`${styles.video} ${!fit ? styles.actual : ''}`} hidden={session.engine !== 'rdp'} style={!fit && state?.width ? { width: state.width, height: state.height } : undefined} tabIndex={0} muted playsInline aria-label={copy.desktop} />
      {session.engine === 'rdp' && phase === 'viewing' ? <DesktopCursorOverlay cursor={cursor} video={video} source={state} owned={owned} fit={fit} /> : null}
      {phase !== 'viewing' || !running ? <div className={styles.overlay}>
        {running && phase !== 'closed' ? <Spin /> : <Monitor size={28} />}
        <strong>{!joined ? copy.vncJoin : status}</strong>
        {!joined ? <><p>{copy.vncHint}</p><Button type="primary" onClick={() => setJoined(true)}>{copy.vncJoin}</Button></> : null}
        {phase === 'closed' ? <><p>{errorText}<br /><code>{errorCode}</code></p><Button icon={<RotateCcw size={14} />} onClick={() => setAttempt(value => value + 1)}>{copy.retry}</Button>{error === 'desktop_control_locked' ? <Popconfirm {...termousPopconfirmProps} title={copy.replace} description={copy.replaceHint} onConfirm={() => { replaceNext.current = true; setAttempt(value => value + 1) }}><Button>{copy.replace}</Button></Popconfirm> : null}</> : null}
      </div> : null}
    </div>
    <footer className={styles.footer}><span>{copy.target} {state?.width ? `${state.width} × ${state.height}` : '—'}</span><span>{copy.video} · {path}</span></footer>
    <Modal open={!!challenge} title={<span className={styles.identity}><ShieldCheck size={18} />{challenge?.kind === 'ssh_certificate' ? 'SSH' : session.engine.toUpperCase()} · {certificate ? copy.challenge : copy.credentials}</span>} onCancel={() => answer(false)} mask={{ closable: false }} okText={certificate ? copy.once : copy.send} cancelText={copy.reject} onOk={() => answer(true)} destroyOnHidden>
      {certificate ? <div className={styles.certificate}><span>{copy.fingerprint}</span><code>{'fingerprint' in challenge ? challenge.fingerprint : ''}</code></div> : <div className={styles.credentials}>{challenge && 'fields' in challenge && challenge.fields.includes('username') ? <Input aria-label={copy.username} placeholder={copy.username} value={username} onChange={event => setUsername(event.target.value)} /> : null}<Input.Password aria-label={copy.password} placeholder={copy.password} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" /></div>}
    </Modal>
    <Modal open={!!tool} title={tool === 'text' ? copy.keyboard : copy.clipboard} onCancel={() => setTool(undefined)} okText={copy.send} cancelText={copy.cancel} confirmLoading={working} okButtonProps={{ disabled: !owned }} onOk={() => void act(async () => { await runtime.current?.command(tool!, text); setText(''); setTool(undefined) })}>
      {tool === 'clipboard' ? <><p>{copy.clipboardHint}</p><Button disabled={!owned || working} onClick={() => void act(async () => { setText(await runtime.current?.readClipboard() ?? '') })}>{copy.receiveClipboard}</Button></> : <Button disabled={!owned} onClick={() => void act(() => runtime.current!.command('ctrl_alt_del'))}>Ctrl + Alt + Delete</Button>}
      <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={tool === 'text' ? 4096 : 32768} value={text} aria-label={copy.text} onChange={event => setText(event.target.value)} />
    </Modal>
  </div>
}
