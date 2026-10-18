import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf'
import { ClientMessageSchema, ServerMessageSchema, InputSchema } from '@termous/rdp-protocol'
import type { RemoteDesktopViewerCreateOptions, RemoteDesktopViewerHandle } from '../../core/viewerContracts.ts'
import { scanCodes } from './keyboard.ts'
import { createRdpSystemFiles } from './systemFiles.ts'
import { createAutomationPointerOverlay } from '../../core/automationPointerOverlay.ts'

export function createRdpViewer(options: RemoteDesktopViewerCreateOptions): RemoteDesktopViewerHandle {
  const attachment = options.transport.kind === 'rdp-pixels' ? options.transport.attachment : undefined
  if (!attachment || !options.session.rdp) throw new Error('RDP_ATTACHMENT_REQUIRED')
  for (const endpoint of [attachment.control_url, attachment.display_url]) {
    const url = new URL(endpoint)
    if (url.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('RDP_ENDPOINT_INVALID')
  }
  const generation = BigInt(options.session.connection_generation)
  const canvas = document.createElement('canvas')
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', 'RDP desktop')
  canvas.style.cssText = 'display:block;margin:auto;outline:none;touch-action:none'
  // 可编辑元素承接系统输入法，画布本身不会可靠地产生组合输入事件。
  const keyboard = document.createElement('textarea')
  keyboard.setAttribute('aria-label', 'RDP keyboard input')
  keyboard.autocomplete = 'off'
  keyboard.spellcheck = false
  keyboard.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;min-width:0;min-height:0;padding:0;border:0;margin:0;opacity:0;overflow:hidden;resize:none;pointer-events:none'
  const worker = new Worker(new URL('./pixels.worker.ts', import.meta.url), { type: 'module' })
  let control: WebSocket
  try {
    control = new WebSocket(attachment.control_url)
  } catch (error) {
    worker.terminate()
    throw error
  }
  control.binaryType = 'arraybuffer'
  let disposed = false
  let connected = false
  let owned = false
  let localReadOnly = options.state.viewOnly
  let controlKnown = false
  let connectedAt: number | null = null
  let controlReceived = 0
  let controlSent = 0
  let displayReceived = 0
  let displaySent = 0
  let lastMetricsAt = Date.now()
  let lastReceived = 0
  let lastSent = 0
  let controlGeneration = 0n
  let sequence = 0n
  let width = options.session.rdp.width
  let height = options.session.rdp.height
  let displayEpoch = 0
  let mode = options.state.displayMode
  let active = true
  let resizeAvailable = false
  let motion: { x: number; y: number } | undefined
  let lastPosition = { x: 0, y: 0 }
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let observer: ResizeObserver | undefined
  let renewTimer: ReturnType<typeof setInterval> | undefined
  let motionTimer: ReturnType<typeof setInterval> | undefined
  let metricsTimer: ReturnType<typeof setInterval> | undefined
  const keys = new Set<number>()
  const buttons = new Set<number>()
  const listeners = new AbortController()
  let inputEpoch = 0
  const pointer = createAutomationPointerOverlay({ target: options.target, feed: options.pointer,
    visible: () => active && connected && !owned && !disposed,
    geometry: () => {
      const rect = canvas.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        remoteX: 0, remoteY: 0, remoteWidth: width, remoteHeight: height, displayEpoch }
    },
  })
  const systemFiles = createRdpSystemFiles({
    id: options.session.id, api: options.desktopFiles,
    context: () => owned && !localReadOnly && !disposed ? { sessionId: options.session.id, generation: Number(generation), subscriptionId: attachment.subscription_id, controlGeneration: Number(controlGeneration) } : undefined,
    focused: () => active && !document.hidden && document.hasFocus() && document.activeElement === keyboard,
    inputEpoch: () => inputEpoch,
    paste() {
      if (!owned || localReadOnly || disposed) return
      for (const [scancode, down] of [[scanCodes.ControlLeft!, true], [scanCodes.KeyV!, true], [scanCodes.KeyV!, false], [scanCodes.ControlLeft!, false]] as const) input({ case: 'key', value: { scancode, down } })
    },
  })

  function send(payload: MessageInitShape<typeof ClientMessageSchema>['payload']) {
    if (disposed || control.readyState !== WebSocket.OPEN) return
    if (control.bufferedAmount > 256 * 1024) { disconnected(); return }
    const data = toBinary(ClientMessageSchema, create(ClientMessageSchema, { payload }))
    controlSent += data.byteLength
    control.send(data)
  }
  function input(operation: MessageInitShape<typeof InputSchema>['operation']) {
    if (!owned || localReadOnly || disposed) return
    send({ case: 'input', value: { sessionGeneration: generation, controlGeneration, sequence: ++sequence, operation } })
  }
  function flushMotion() {
    if (!motion) return
    input({ case: 'mouse', value: { flags: 0x0800, ...motion } })
    motion = undefined
  }
  function releasePressed() {
    flushMotion()
    for (const scancode of keys) input({ case: 'key', value: { scancode, down: false } })
    for (const button of buttons) input({ case: 'mouse', value: { flags: button, ...lastPosition } })
    keys.clear()
    buttons.clear()
  }
  function dispose() {
    if (disposed) return
    systemFiles.dispose()
    pointer.dispose()
    disposed = true
    // 断开订阅会由服务端释放输入状态；关闭期间不再发送，避免拥塞触发递归清理。
    motion = undefined
    keys.clear()
    buttons.clear()
    listeners.abort()
    observer?.disconnect()
    clearInterval(renewTimer)
    clearInterval(motionTimer)
    clearInterval(metricsTimer)
    clearTimeout(resizeTimer)
    worker.terminate()
    control.close()
    canvas.remove()
    keyboard.remove()
    delete options.target.dataset.termousDesktopSession
  }
  function disconnected() {
    if (disposed) return
    dispose()
    options.events.onDisconnected(false)
  }
  function layout() {
    if (disposed) return
    pointer.refresh()
    const rect = options.target.getBoundingClientRect()
    const scale = mode === 'actual' ? 1 : Math.min(rect.width / width, rect.height / height)
    canvas.style.width = `${Math.max(1, width * scale)}px`
    canvas.style.height = `${Math.max(1, height * scale)}px`
    clearTimeout(resizeTimer)
    if (mode === 'resize' && active && owned && resizeAvailable && rect.width >= 200 && rect.height >= 200) {
      const w = Math.min(8192, Math.floor(rect.width / 2) * 2)
      const h = Math.min(8192, Math.floor(rect.height / 2) * 2)
      if (w * h <= 16 * 1024 * 1024 && (w !== width || h !== height)) resizeTimer = setTimeout(() => input({ case: 'resize', value: { width: w, height: h } }), 300)
    }
  }
  const initialize = () => {
    options.target.dataset.termousDesktopSession = options.session.id
    options.target.appendChild(canvas)
    options.target.appendChild(keyboard)
    control.onopen = () => {
      send({ case: 'authenticate', value: { ticket: attachment.control_ticket } })
      send({ case: 'viewport', value: { active: active && !document.hidden, readOnly: localReadOnly } })
    }
    control.onerror = disconnected
    control.onclose = disconnected
    control.onmessage = (event) => {
      if (disposed) return
      try {
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 512 * 1024) throw new Error('RDP_CONTROL_LIMIT')
        controlReceived += event.data.byteLength
        const { payload } = fromBinary(ServerMessageSchema, new Uint8Array(event.data))
        if (payload.case === 'session') {
          const state = payload.value
          if (state.sessionGeneration !== generation || state.sessionId !== options.session.id) throw new Error('RDP_SESSION_MISMATCH')
          const controlChanged = state.control?.generation !== controlGeneration
          if (controlChanged) {
            inputEpoch++
            controlGeneration = state.control?.generation ?? 0n
            sequence = 0n
            keys.clear()
            buttons.clear()
            motion = undefined
          }
          const nextOwned = state.control?.subscriptionId === attachment.subscription_id
          if (!controlKnown || nextOwned !== owned || controlChanged) { controlKnown = true; owned = nextOwned; options.events.onControlChanged?.(owned, owned ? { id: attachment.subscription_id, generation: Number(controlGeneration) } : null) }
          resizeAvailable = state.resizeAvailable
          systemFiles.changed()
          layout()
          if (state.state === 'failed' || state.state === 'closed') disconnected()
        } else if (payload.case === 'clipboard') options.events.onClipboard(payload.value.text)
        else if (payload.case === 'cursor') {
          const c = payload.value
          if (c.kind === 'hidden') canvas.style.cursor = 'none'
          else if (c.kind === 'default') canvas.style.cursor = 'default'
          else if (c.width > 0 && c.width <= 256 && c.height > 0 && c.height <= 256 && c.rgba.byteLength === c.width * c.height * 4) {
            const cursor = document.createElement('canvas')
            cursor.width = c.width; cursor.height = c.height
            cursor.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(c.rgba), c.width, c.height), 0, 0)
            canvas.style.cursor = `url(${cursor.toDataURL()}) ${Math.min(c.hotspotX, c.width - 1)} ${Math.min(c.hotspotY, c.height - 1)}, default`
          }
        } else if (payload.case === 'fault') {
          if (!payload.value.uncertain && ['rdp_control_locked', 'rdp_control_stale'].includes(payload.value.code)) return
          // 输入结果不明时关闭订阅，绝不重放按键或剪贴板写入。
          disconnected()
        }
      } catch { disconnected() }
    }
    worker.onmessage = (event: MessageEvent<{ type: string; width: number; height: number; displayEpoch: number; receivedBytes: number; sentBytes: number }>) => {
      if (event.data.type === 'error') { disconnected(); return }
      if (disposed) return
      width = event.data.width; height = event.data.height
      displayEpoch = event.data.displayEpoch
      displayReceived = event.data.receivedBytes
      displaySent = event.data.sentBytes
      layout()
      if (!connected) { connected = true; connectedAt = Date.now(); options.events.onConnected() }
    }
    worker.onerror = disconnected
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage({ canvas: offscreen, url: attachment.display_url, ticket: attachment.display_ticket, generation }, [offscreen])
    observer = new ResizeObserver(layout)
    observer.observe(options.target)
    renewTimer = setInterval(() => { if (owned) send({ case: 'control', value: { action: 'renew', generation: controlGeneration } }) }, 10000)
    motionTimer = setInterval(flushMotion, 16)
    metricsTimer = setInterval(() => {
      const now = Date.now()
      const elapsed = Math.max(1, now - lastMetricsAt) / 1000
      const receivedBytes = controlReceived + displayReceived
      const sentBytes = controlSent + displaySent
      options.events.onMetrics({ connectedAt, sampledAt: now, receivedBytes, sentBytes, receiveBytesPerSecond: (receivedBytes - lastReceived) / elapsed, sendBytesPerSecond: (sentBytes - lastSent) / elapsed, bufferedAmount: control.bufferedAmount, outboundMeasured: true })
      lastMetricsAt = now; lastReceived = receivedBytes; lastSent = sentBytes
    }, 1000)
    const listenerOptions = { signal: listeners.signal }
    const position = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      lastPosition = { x: Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) * width / rect.width))), y: Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) * height / rect.height))) }
      return lastPosition
    }
    canvas.addEventListener('pointermove', (event) => { if (owned) motion = position(event) }, listenerOptions)
    canvas.addEventListener('pointerdown', (event) => {
      if (!owned) return
      inputEpoch++
      event.preventDefault(); keyboard.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId)
      const flag = [0x1000, 0x4000, 0x2000][event.button]
      if (!flag) return
      flushMotion(); buttons.add(flag); input({ case: 'mouse', value: { flags: flag | 0x8000, ...position(event) } })
    }, listenerOptions)
    canvas.addEventListener('pointerup', (event) => {
      const flag = [0x1000, 0x4000, 0x2000][event.button]
      if (!flag || !buttons.has(flag)) return
      flushMotion(); buttons.delete(flag); input({ case: 'mouse', value: { flags: flag, ...position(event) } })
    }, listenerOptions)
    canvas.addEventListener('pointercancel', releasePressed, listenerOptions)
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), listenerOptions)
    canvas.addEventListener('wheel', (event) => {
      if (!owned) return
      inputEpoch++
      event.preventDefault(); flushMotion()
      const delta = event.deltaY || event.deltaX
      const rotation = delta > 0 ? 0x0188 : 120
      input({ case: 'mouse', value: { flags: (event.deltaY ? 0x0200 : 0x0400) | rotation, ...position(event) } })
    }, { ...listenerOptions, passive: false })
    keyboard.addEventListener('keydown', (event) => {
      if (!owned || event.isComposing || event.key === 'Process') return
      if (event.code === 'KeyV' && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && systemFiles.interceptPaste()) {
        event.preventDefault(); event.stopPropagation(); releasePressed()
        if (!event.repeat) void systemFiles.prepare(false)
        return
      }
      inputEpoch++
      const scancode = scanCodes[event.code]
      if (!scancode) return
      event.preventDefault(); event.stopPropagation(); flushMotion(); keys.add(scancode)
      input({ case: 'key', value: { scancode, down: true, repeat: event.repeat } })
    }, listenerOptions)
    keyboard.addEventListener('keyup', (event) => {
      const scancode = scanCodes[event.code]
      if (!scancode || !keys.has(scancode)) return
      event.preventDefault(); event.stopPropagation(); flushMotion(); keys.delete(scancode)
      input({ case: 'key', value: { scancode, down: false } })
    }, listenerOptions)
    keyboard.addEventListener('compositionend', (event) => { if (owned && event.data) { inputEpoch++; input({ case: 'text', value: { text: event.data } }) }; keyboard.value = '' }, listenerOptions)
    keyboard.addEventListener('input', (event) => { if (!(event as InputEvent).isComposing) keyboard.value = '' }, listenerOptions)
    keyboard.addEventListener('blur', () => { inputEpoch++; releasePressed(); systemFiles.changed() }, listenerOptions)
    keyboard.addEventListener('focus', () => systemFiles.changed(), listenerOptions)
    canvas.addEventListener('focus', () => keyboard.focus({ preventScroll: true }), listenerOptions)
    window.addEventListener('blur', () => { inputEpoch++; releasePressed(); systemFiles.changed() }, listenerOptions)
    options.target.addEventListener('dragover', event => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
      event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = owned && !localReadOnly ? 'copy' : 'none'
      systemFiles.drag(true)
    }, listenerOptions)
    options.target.addEventListener('dragleave', event => { if (!options.target.contains(event.relatedTarget as Node | null)) systemFiles.drag(false) }, listenerOptions)
    options.target.addEventListener('drop', event => {
      systemFiles.drag(false)
      if (!event.dataTransfer?.files.length) return
      event.preventDefault(); event.stopPropagation()
      if (owned && !localReadOnly) { inputEpoch++; releasePressed(); void systemFiles.prepare(true) }
    }, listenerOptions)
    document.addEventListener('visibilitychange', () => { if (document.hidden) { inputEpoch++; releasePressed() }; systemFiles.changed(); send({ case: 'viewport', value: { active: active && !document.hidden } }) }, listenerOptions)
    layout()
  }
  try {
    initialize()
  } catch (error) {
    dispose()
    throw error
  }
  return {
    dispose,
    setDisplayMode(value) { mode = value; layout() },
    setViewOnly(value) {
      if (value !== localReadOnly) inputEpoch++
      if (value) { releasePressed(); if (owned) send({ case: 'control', value: { action: 'release', generation: controlGeneration } }) }
      else void options.takeControl?.(attachment.subscription_id).catch(disconnected)
      localReadOnly = value
      systemFiles.changed()
      send({ case: 'viewport', value: { active: active && !document.hidden, readOnly: value } })
    },
    setViewportActive(value, displayMode) { active = value; mode = displayMode; if (!value) { inputEpoch++; releasePressed() }; systemFiles.changed(); send({ case: 'viewport', value: { active: active && !document.hidden } }); layout() },
    focus() { keyboard.focus({ preventScroll: true }) }, blur() { keyboard.blur() },
    sendCredentials() { throw new Error('RDP_CREDENTIALS_MANAGED_BY_CORE') },
    approveServer() { throw new Error('RDP_CERTIFICATE_MANAGED_BY_CORE') },
    sendCtrlAltDel() { inputEpoch++; flushMotion(); input({ case: 'specialKey', value: { name: 'ctrl_alt_del' } }) },
    sendClipboard(text) { if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('RDP_CLIPBOARD_LIMIT'); inputEpoch++; input({ case: 'clipboard', value: { text } }) },
  }
}
