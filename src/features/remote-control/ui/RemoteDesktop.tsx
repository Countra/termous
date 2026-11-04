import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, Popconfirm, Select, Spin, Tag, Tooltip } from 'antd'
import { Clipboard, Keyboard, Maximize, Monitor, RotateCcw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RemoteDesktopSession, type DesktopSessionEvents, type DesktopState, type DesktopTarget, type DesktopMediaSnapshot, type H264ReceiverState } from '@termous/remote-protocol/desktop'
import { DesktopPresentationControls } from '#entities/desktop-presentation'
import type { RemoteDesktopMediaChanged } from '#entities/remote-desktop'
import type { PresentationState } from '#entities/remote-desktop'
import type { PresentationPreference } from '@termous/remote-protocol/presentation'
import type { RemoteLocalTask } from '#common/contracts'
import type { RemoteClient, Session } from '#entities/remote-control'
import { termousPopconfirmProps } from '#shared/ui'
import { bindDesktopInput } from '../model/desktopInput'
import { desktopCopy, desktopErrorText } from '../model/desktopCopy'
import styles from './RemoteDesktop.module.scss'
import { DesktopCursorOverlay } from './DesktopCursorOverlay'
import { type CursorState, updateCursor } from '../model/desktopCursor'
import { RemoteDesktopFiles } from './RemoteDesktopFiles'

type Challenge = Parameters<DesktopSessionEvents['challenge']>[0]
type Reply = Awaited<ReturnType<DesktopSessionEvents['challenge']>>

type DesktopProps = { onMediaDetails?: RemoteDesktopMediaChanged; client: RemoteClient; active: boolean; localTasks?: RemoteLocalTask[]; changed?: () => void } & ({ session: Session; target?: never } | { session?: never; target: DesktopTarget })

export function RemoteDesktop({ onMediaDetails, client, session, target: hostTarget, active, localTasks = [], changed = () => {} }: DesktopProps) {
  const id = session?.id ?? '', generation = session?.generation ?? 0n, engine = session?.engine ?? 'host'
  const preferenceID = hostTarget ? `${hostTarget.instanceId}:${hostTarget.sourceId}` : id
  const preferenceGeneration = hostTarget?.sourceGeneration ?? generation
  const { i18n } = useTranslation()
  const copy = desktopCopy(i18n.language?.startsWith('zh') ?? false)
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  const preferences = hostTarget ? client.hostPresentations : client.presentations
  const entry = useMemo(() => preferences.capture(preferenceID, preferenceGeneration), [preferences, preferenceID, preferenceGeneration])
  const preference = entry.preference
  const [presentation, setPresentation] = useState<PresentationState>()
  const [presentationEpoch, setPresentationEpoch] = useState(0)
  const [resolutionStatus, setResolutionStatus] = useState('idle')
  const [sample, setSample] = useState<DesktopMediaSnapshot>()
  const [receiver, setReceiver] = useState<H264ReceiverState>()
  const mediaCallback = useRef(onMediaDetails)
  mediaCallback.current = onMediaDetails
  const mediaKey = hostTarget ? 'host' : id
  const runtime = useRef<RemoteDesktopSession>(undefined)
  const closing = useRef(Promise.resolve())
  const nativeNext = useRef(false)
  const replaceNext = useRef(false)
  const pending = useRef(false)
  const reply = useRef<((value: Reply) => void) | undefined>(undefined)
  const [cursor, setCursor] = useState<CursorState>()
  const [challenge, setChallenge] = useState<Challenge>()
  const [password, setPassword] = useState(''), [username, setUsername] = useState('')
  const [phase, setPhase] = useState('idle'), [error, setError] = useState(''), [state, setState] = useState<DesktopState>()
  const [attempt, setAttempt] = useState(0), [joined, setJoined] = useState(engine !== 'vnc')
  const [working, setWorking] = useState(false), [tool, setTool] = useState<'text' | 'clipboard'>()
  const [scaleChoice, setScaleChoice] = useState<{ scope: PresentationPreference; fit: boolean }>()
  const fit = scaleChoice?.scope === preference ? scaleChoice.fit : true
  const setFit = (value: boolean) => setScaleChoice({ scope: preference, fit: value })
  const [text, setText] = useState(''), [remoteClipboard, setRemoteClipboard] = useState(''), [path, setPath] = useState('—')
  const targetReady = hostTarget ? true : generation > 0n && !['failed', 'stopping'].includes(session!.state)
  const running = joined && targetReady && (engine === 'vnc' || active)
  useEffect(() => () => mediaCallback.current?.(mediaKey), [mediaKey])
  useEffect(() => {
    mediaCallback.current?.(mediaKey, running && active ? { connectionId: client.connection.id, title: session?.name || hostTarget?.sourceId || id, transport: engine === 'vnc' ? 'rfb' : 'h264', phase, presentation, receiver, sample: phase === 'viewing' ? sample : undefined } : undefined)
  }, [mediaKey, client, session?.name, hostTarget?.sourceId, id, engine, phase, presentation, receiver, sample, running, active])
  useEffect(() => {
    if (!running || !canvas.current || !video.current) { setPhase('idle'); setChallenge(undefined); return }
    let alive = true
    const view = new RemoteDesktopSession({ receiverPolicy: nativeNext.current ? 'native' : client.bridge?.desktopReceiverPolicy, capabilities: client.connection?.capabilities, protocol: engine === 'rdp' || engine === 'vnc' ? engine : undefined, onEnvironment: listener => client.onEvent(event => { if (event.value.case === 'desktopEnvironment') listener(event.value.value) }), request: value => client.desktop(value), ice: () => client.desktopICE() }, id, generation, {
      inputReset: () => { if (alive) { setCursor(undefined); setTool(undefined); setText('') } },
      resolution: value => { if (alive) setResolutionStatus(value.status) },
      presentation: value => { if (alive) setPresentation(value) },
      state: value => { if (alive) setState(value) },
      status: (phase, reason) => { if (alive) { setPhase(phase); setError(reason ?? ''); if (phase === 'closed') { reply.current?.({ accept: false }); reply.current = undefined; setChallenge(undefined); setPassword(''); setUsername('') }; if (!hostTarget && reason === 'desktop_display_changed') setAttempt(value => value + 1) } },
      clipboard: value => { if (alive) setRemoteClipboard(value) },
      media: value => { if (alive) setSample(value) },
      receiver: value => { if (alive) setReceiver(value) },
      network: value => { if (alive) setPath(value) },
      cursor: value => { if (alive) setCursor(previous => updateCursor(previous, value)) },
      challenge: challenge => new Promise(resolve => { if (!alive) { resolve({ accept: false }); return }; reply.current?.({ accept: false }); const timer = setTimeout(() => { reply.current = undefined; setChallenge(undefined); resolve({ accept: false }) }, 90_000); reply.current = value => { clearTimeout(timer); resolve(value) }; setPassword(''); setUsername(''); setChallenge(challenge) }),
    }, preference, hostTarget)
    nativeNext.current = false
    runtime.current = view
    setPresentationEpoch(value => value + 1)
    pending.current = false
    setWorking(false); setPhase('connecting'); setChallenge(undefined); setPassword(''); setUsername('')
    setResolutionStatus('idle'); setSample(undefined); setReceiver(undefined); setPresentation(undefined); setState(undefined); setCursor(undefined); setError(''); setPath('—')
    const unbind = bindDesktopInput(video.current, view, () => { view.close(); setPhase('closed'); setError('desktop_input_uncertain') })
    const target = canvas.current, player = video.current
    // 接替仅对本次明确操作生效；等待旧附着撤销，避免重连与自身争抢席位。
    const replace = replaceNext.current
    replaceNext.current = false
    void closing.current.then(async () => { await entry.ready; if (alive) return view.start(target, player, replace) })
    return () => { alive = false; reply.current?.({ accept: false }); reply.current = undefined; unbind(); closing.current = closing.current.then(() => view.close()); runtime.current = undefined }
  }, [client, engine, id, generation, hostTarget, running, attempt, preference, entry])
  useEffect(() => {
    // 新播放器就绪后恢复本会话的缩放；连接代次变化由偏好作用域重置。
    if (phase === 'viewing') runtime.current?.display(fit)
  }, [fit, phase, attempt])
  const act = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    const view = runtime.current
    pending.current = true
    setWorking(true); setError('')
    try { await action() } catch (error) { if (runtime.current === view) setError(error instanceof Error ? error.message : 'desktop_operation_failed') } finally { if (runtime.current === view) { pending.current = false; setWorking(false) } }
  }
  const answer = (accept: boolean) => { const respond = reply.current; reply.current = undefined; setChallenge(undefined); respond?.({ accept, password, username }); setPassword(''); setUsername('') }
  const reconnectNative = async () => {
    const current = runtime.current
    await current?.close()
    // 等待清理期间目标或运行代次可能已经改变，旧操作不能重启新的观看会话。
    if (runtime.current !== current) return
    if (!current?.cleanupConfirmed) throw new Error('desktop_cleanup_uncertain')
    nativeNext.current = true
    setAttempt(value => value + 1)
  }
  const owned = running && phase === 'viewing' && runtime.current?.owned === true
  const status = phase === 'viewing' ? owned ? copy.control : state?.control ? ['local', 'local-viewer'].includes(state.control.owner) ? copy.local : copy.other : copy.watching : phase === 'closed' ? copy.failed : !running ? copy.paused : phase === 'recovering' ? copy.recovering : phase === 'switching' ? copy.switching : phase === 'paused' ? copy.windowPaused : copy.connecting
  const errorText = desktopErrorText(error, copy)
  const errorCode = /^(?:desktop|remote|rdp)_[a-z0-9_]{1,80}$/.test(error) ? error : 'desktop_operation_failed'
  const certificate = challenge && (challenge.kind === 'certificate' || challenge.kind === 'vnc_certificate' || challenge.kind === 'ssh_certificate')
  return <div className={styles.desktop} ref={root}>
    <div className={styles.toolbar}>
      <div className={styles.identity}><Monitor size={15} /><Tag>{engine === 'host' ? (hostTarget?.sourceKind === 'window' ? (i18n.language?.startsWith('zh') ? '只读窗口' : 'View-only window') : (i18n.language?.startsWith('zh') ? '设备桌面' : 'Device desktop')) : engine.toUpperCase()}</Tag><span role="status">{status}</span></div>
      <div className={styles.actions}>
        {session && state?.capabilities.includes('files') ? <RemoteDesktopFiles key={`${session.id}:${session.generation}`} client={client} session={session} desktop={runtime.current} available={active && phase === 'viewing'} localTasks={localTasks} changed={changed} getContainer={() => root.current!} /> : null}
        <Button size="small" disabled={phase !== 'viewing' || working || !state?.capabilities.includes('pointer')} loading={working} onClick={() => void act(() => owned ? runtime.current!.release() : runtime.current!.acquire(true))}>{owned ? copy.release : copy.take}</Button>
        <Select size="small" value={fit ? 'fit' : 'actual'} aria-label={copy.fit} options={[{ value: 'fit', label: copy.fit }, { value: 'actual', label: copy.actual }]} onChange={mode => { setFit(mode === 'fit'); runtime.current?.display(mode === 'fit') }} />
        <Tooltip title={copy.keyboard}><Button size="small" type="text" disabled={!owned || !state?.capabilities.includes('text')} icon={<Keyboard size={16} />} aria-label={copy.keyboard} onClick={() => { setText(''); setTool('text') }} /></Tooltip>
        <Tooltip title={copy.clipboard}><Button size="small" type="text" disabled={!owned || !state?.capabilities.includes('clipboard')} icon={<Clipboard size={16} />} aria-label={copy.clipboard} onClick={() => { setText(remoteClipboard); setTool('clipboard') }} /></Tooltip>
        <DesktopPresentationControls sessionKey={String(presentationEpoch)} resolutionStatus={resolutionStatus} scale={fit ? 'fit' : 'actual'} onScale={mode => { setFit(mode === 'fit'); runtime.current?.display(mode === 'fit') }} state={presentation} disabled={phase !== 'viewing'} onChange={value => runtime.current?.configure(value)} resizeSupported={state?.capabilities.includes('resize') === true} resizeAvailable={owned && state?.capabilities.includes('resize') === true} onResize={(width, height) => void act(() => runtime.current!.resize(width, height))} />
        <Tooltip title={copy.fullscreen}><Button size="small" type="text" icon={<Maximize size={16} />} aria-label={copy.fullscreen} onClick={() => void act(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen() })} /></Tooltip>
      </div>
    </div>
    {error && phase !== 'closed' ? <div className={styles.notice} role="alert">{errorText}</div> : null}
    <div className={styles.surface}>
      <div ref={canvas} className={styles.canvas} hidden={engine !== 'vnc'} />
      <video ref={video} className={`${styles.video} ${!fit ? styles.actual : ''}`} hidden={engine === 'vnc'}  tabIndex={0} muted playsInline aria-label={copy.desktop} />
      {engine === 'rdp' && phase === 'viewing' ? <DesktopCursorOverlay cursor={cursor} video={video} source={state} owned={owned} fit={fit} /> : null}
      {phase !== 'viewing' || !running ? <div className={`${styles.overlay} ${phase === 'switching' ? styles.switching : ''}`}>
        {running && phase !== 'closed' ? <Spin /> : <Monitor size={28} />}
        <strong>{!joined ? copy.vncJoin : status}</strong>
        {!joined ? <><p>{copy.vncHint}</p><Button type="primary" onClick={() => setJoined(true)}>{copy.vncJoin}</Button></> : null}
        {phase === 'closed' ? <><p>{errorText}<br /><code>{errorCode}</code></p><Button icon={<RotateCcw size={14} />} disabled={working} onClick={() => setAttempt(value => value + 1)}>{copy.retry}</Button>{error === 'desktop_h264_unsupported' ? <Button loading={working} onClick={() => void act(reconnectNative)}>{i18n.language.startsWith('zh') ? '以兼容模式重新连接' : 'Reconnect with native capabilities'}</Button> : null}{error === 'desktop_control_locked' ? <Popconfirm {...termousPopconfirmProps} title={copy.replace} description={copy.replaceHint} onConfirm={() => { replaceNext.current = true; setAttempt(value => value + 1) }}><Button>{copy.replace}</Button></Popconfirm> : null}</> : null}
      </div> : null}
    </div>
    <footer className={styles.footer}><span>{copy.target} {state?.width ? `${state.width} × ${state.height}` : '—'}</span><span>{presentation?.observed?.width ? `${presentation.observed.width} × ${presentation.observed.height} · ` : ''}{presentation?.observed?.bitrate === undefined ? '' : `${(presentation.observed.bitrate / 1_000_000).toFixed(2)} Mbps · `}{path}</span></footer>
    <Modal open={!!challenge} title={<span className={styles.identity}><ShieldCheck size={18} />{challenge?.kind === 'ssh_certificate' ? 'SSH' : engine.toUpperCase()} · {certificate ? copy.challenge : copy.credentials}</span>} onCancel={() => answer(false)} mask={{ closable: false }} okText={certificate ? copy.once : copy.send} cancelText={copy.reject} onOk={() => answer(true)} destroyOnHidden>
      {certificate ? <div className={styles.certificate}><span>{copy.fingerprint}</span><code>{'fingerprint' in challenge ? challenge.fingerprint : ''}</code></div> : <div className={styles.credentials}>{challenge && 'fields' in challenge && challenge.fields.includes('username') ? <Input aria-label={copy.username} placeholder={copy.username} value={username} onChange={event => setUsername(event.target.value)} /> : null}<Input.Password aria-label={copy.password} placeholder={copy.password} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" /></div>}
    </Modal>
    <Modal open={!!tool} title={tool === 'text' ? copy.keyboard : copy.clipboard} onCancel={() => setTool(undefined)} okText={copy.send} cancelText={copy.cancel} confirmLoading={working} okButtonProps={{ disabled: !owned }} onOk={() => void act(async () => { await runtime.current?.command(tool!, text); setText(''); setTool(undefined) })}>
      {tool === 'clipboard' ? <><p>{copy.clipboardHint}</p><Button disabled={!owned || working} onClick={() => void act(async () => { setText(await runtime.current?.readClipboard() ?? '') })}>{copy.receiveClipboard}</Button></> : state?.capabilities.includes('ctrl_alt_del') ? <Button disabled={!owned} onClick={() => void act(() => runtime.current!.command('ctrl_alt_del'))}>Ctrl + Alt + Delete</Button> : null}
      <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={tool === 'text' ? 4096 : 32768} value={text} aria-label={copy.text} onChange={event => setText(event.target.value)} />
    </Modal>
  </div>
}
