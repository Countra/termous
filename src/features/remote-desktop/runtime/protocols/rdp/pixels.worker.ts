import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { ClientMessageSchema, ServerMessageSchema, type Frame } from '@termous/rdp-protocol'

// 画面通道完全在 Worker 中解码和绘制，主线程仅处理窗口及输入。
let socket: WebSocket | undefined
let canvas: OffscreenCanvas
let gl: WebGL2RenderingContext
let texture: WebGLTexture
let generation = 0n
let batch: Frame | undefined
let epoch = 0n
let sequence = 0n
let tiles = new Set<string>()
let chain = Promise.resolve()
let failed = false
let receivedBytes = 0
let sentBytes = 0

function fail() {
  if (failed) return
  failed = true
  socket?.close()
  self.postMessage({ type: 'error' })
}

function shader(kind: number, source: string) {
  const result = gl.createShader(kind)
  if (!result) throw new Error('RDP_SHADER_CREATE_FAILED')
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('RDP_SHADER_COMPILE_FAILED')
  return result
}

function initialize(target: OffscreenCanvas) {
  canvas = target
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true })
  if (!context) throw new Error('RDP_WEBGL2_UNAVAILABLE')
  gl = context
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const createdTexture = gl.createTexture()
  if (!program || !buffer || !createdTexture) throw new Error('RDP_WEBGL_ALLOCATION_FAILED')
  texture = createdTexture
  const vertex = shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 position;out vec2 uv;void main(){uv=vec2((position.x+1.0)/2.0,(1.0-position.y)/2.0);gl_Position=vec4(position,0.0,1.0);}')
  const fragment = shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;in vec2 uv;uniform sampler2D pixels;out vec4 color;void main(){color=vec4(texture(pixels,uv).bgr,1.0);}')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('RDP_WEBGL_LINK_FAILED')
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const location = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  canvas.addEventListener('webglcontextlost', fail)
}

async function inflate(frame: Frame) {
  const expected = frame.tileWidth * frame.tileHeight * 4
  if (frame.encoding === 'raw') {
    if (frame.pixels.byteLength !== expected) throw new Error('RDP_PIXEL_LENGTH')
    return frame.pixels
  }
  if (frame.encoding !== 'zlib' || frame.pixels.byteLength > 65536) throw new Error('RDP_PIXEL_ENCODING')
  const stream = new Blob([new Uint8Array(frame.pixels)]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader = stream.getReader()
  const result = new Uint8Array(expected)
  let offset = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.length > expected) throw new Error('RDP_PIXEL_OVERFLOW')
      result.set(value, offset)
      offset += value.length
    }
  } finally {
    await reader.cancel()
  }
  if (offset !== expected) throw new Error('RDP_PIXEL_LENGTH')
  return result
}

async function receive(data: ArrayBuffer) {
  receivedBytes += data.byteLength
  if (failed || data.byteLength > 128 * 1024) throw new Error('RDP_FRAME_LIMIT')
  const message = fromBinary(ServerMessageSchema, new Uint8Array(data))
  if (message.payload.case !== 'frame') throw new Error('RDP_FRAME_REQUIRED')
  const f = message.payload.value
  if (f.sessionGeneration !== generation || !f.displayEpoch || !f.sequence
    || f.width < 200 || f.height < 200 || f.width > 8192 || f.height > 8192 || f.width * f.height > 16 * 1024 * 1024) throw new Error('RDP_FRAME_IDENTITY')
  if (f.begin) {
    if (batch || f.commit || f.displayEpoch < epoch || (f.displayEpoch === epoch && (f.sequence < sequence || (f.sequence === sequence && !f.snapshot)))) throw new Error('RDP_FRAME_ORDER')
    if (f.displayEpoch !== epoch && !f.snapshot) throw new Error('RDP_SNAPSHOT_REQUIRED')
    batch = f
    tiles = new Set()
    if (f.snapshot) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, f.width, f.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    return
  }
  if (!batch || batch.displayEpoch !== f.displayEpoch || batch.sequence !== f.sequence || batch.width !== f.width || batch.height !== f.height) throw new Error('RDP_FRAME_ORDER')
  if (f.commit) {
    if (batch.snapshot && tiles.size !== Math.ceil(f.width / 128) * Math.ceil(f.height / 128)) throw new Error('RDP_SNAPSHOT_INCOMPLETE')
    if (canvas.width !== f.width) canvas.width = f.width
    if (canvas.height !== f.height) canvas.height = f.height
    gl.viewport(0, 0, f.width, f.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('RDP_WEBGL_ERROR')
    epoch = f.displayEpoch
    sequence = f.sequence
    batch = undefined
    const ack = toBinary(ClientMessageSchema, create(ClientMessageSchema, { payload: { case: 'frameAck', value: { displayEpoch: epoch, sequence } } }))
    sentBytes += ack.byteLength
    socket?.send(ack)
    self.postMessage({ type: 'frame', width: f.width, height: f.height, displayEpoch: Number(epoch), receivedBytes, sentBytes })
    return
  }
  const key = `${f.x}:${f.y}`
  if (tiles.has(key) || f.x % 128 || f.y % 128 || f.tileWidth !== Math.min(128, f.width - f.x) || f.tileHeight !== Math.min(128, f.height - f.y) || !f.tileWidth || !f.tileHeight || f.x >= f.width || f.y >= f.height) throw new Error('RDP_TILE_BOUNDS')
  tiles.add(key)
  const pixels = await inflate(f)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, f.x, f.y, f.tileWidth, f.tileHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
}

self.onmessage = (event: MessageEvent<{ canvas: OffscreenCanvas; url: string; ticket: string; generation: bigint }>) => {
  try {
    if (socket) throw new Error('RDP_WORKER_REUSED')
    initialize(event.data.canvas)
    generation = event.data.generation
    socket = new WebSocket(event.data.url)
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => socket?.send(toBinary(ClientMessageSchema, create(ClientMessageSchema, { payload: { case: 'authenticate', value: { ticket: event.data.ticket } } })))
    socket.onmessage = (message) => { chain = chain.then(() => receive(message.data as ArrayBuffer)).catch(fail) }
    socket.onclose = fail
    socket.onerror = fail
  } catch { fail() }
}
