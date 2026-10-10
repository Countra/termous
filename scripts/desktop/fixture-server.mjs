import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createServer as createTCPServer } from 'node:net'
import { WebSocketServer } from 'ws'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const events = []
const sockets = new WebSocketServer({ host: '127.0.0.1', port: 5192 })
const vite = await createServer({ configFile: false, root, cacheDir: fileURLToPath(new URL('../../../TEMP/vite', import.meta.url)), plugins: [react(), { name: 'desktop-fixture', configureServer(server) {
  server.middlewares.use('/__fixture/events', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(events)) })
} }], server: { host: '127.0.0.1', port: 5191, strictPort: true, hmr: false, proxy: { '/api': { target: 'http://127.0.0.1:5193', ws: true }, '/fixture': { target: 'http://127.0.0.1:5195' } } } })
await vite.listen()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function png() {
  const chunk = (name, bytes) => { const type = Buffer.from(name), out = Buffer.alloc(12 + bytes.length); out.writeUInt32BE(bytes.length); type.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([type, bytes])), 8 + bytes.length); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(4); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 2
  const raw = Buffer.alloc(4 * 13)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) raw[y * 13 + 1 + x * 3 + 1] = 255
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function rectangle(x, y, width, height, encoding, bytes) {
  const header = Buffer.alloc(12); header.writeUInt16BE(x); header.writeUInt16BE(y, 2); header.writeUInt16BE(width, 4); header.writeUInt16BE(height, 6); header.writeInt32BE(encoding, 8)
  return Buffer.concat([header, bytes])
}

function rfbConnection(ws) {
  events.length = 0
  let stage = 'version', buffer = Buffer.alloc(0), sent = false
  let shifts = [16, 8, 0]
  ws.send(Buffer.from('RFB 003.008\n'))
  const frame = () => {
    const pixels = Buffer.alloc(800 * 600 * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.writeUInt32LE((30 << shifts[0]) | (20 << shifts[1]) | (10 << shifts[2]), i)
    const copy = Buffer.alloc(4)
    const image = png()
    const rectangles = [rectangle(0, 0, 800, 600, 0, pixels), rectangle(40, 40, 16, 16, 1, copy), rectangle(100, 100, 4, 4, -260, Buffer.concat([Buffer.from([0xa0, image.length]), image]))]
    ws.send(Buffer.concat([Buffer.from([0, 0, 0, rectangles.length]), ...rectangles]))
  }
  ws.on('message', (data) => {
    buffer = Buffer.concat([buffer, data])
    for (;;) {
      if (stage === 'version') { if (buffer.length < 12) return; buffer = buffer.subarray(12); ws.send(Buffer.from([1, 1])); stage = 'security' }
      else if (stage === 'security') { if (!buffer.length) return; buffer = buffer.subarray(1); ws.send(Buffer.alloc(4)); stage = 'init' }
      else if (stage === 'init') {
        if (!buffer.length) return
        buffer = buffer.subarray(1)
        const name = Buffer.from('Termous desktop fixture'), header = Buffer.alloc(24)
        header.writeUInt16BE(800); header.writeUInt16BE(600, 2); header[4] = 32; header[5] = 24; header[7] = 1
        header.writeUInt16BE(255, 8); header.writeUInt16BE(255, 10); header.writeUInt16BE(255, 12); header[14] = 16; header[15] = 8; header.writeUInt32BE(name.length, 20)
        ws.send(Buffer.concat([header, name])); stage = 'messages'
      } else {
        if (!buffer.length) return
        const type = buffer[0]
        let size = ({ 0: 20, 2: 4, 3: 10, 4: 8, 5: 6, 6: 8, 150: 10, 248: 9 })[type]
        if (!size) { ws.close(); return }
        if (buffer.length < size) return
        if (type === 2) size += buffer.readUInt16BE(2) * 4
        if (type === 6) size += buffer.readUInt32BE(4)
        if (type === 248) size += buffer[8]
        if (buffer.length < size) return
        const message = buffer.subarray(0, size); buffer = buffer.subarray(size)
        if (type === 0) shifts = [message[14], message[15], message[16]]
        if (type === 3 && !sent) { sent = true; frame() }
        if (type === 4) {
          const keysym = message.readUInt32BE(4)
          events.push({ kind: 'key', down: message[1] === 1, keysym })
          // F8 在协议夹具中触发尺寸变化，不依赖真实桌面或系统显示设置。
          if (keysym === 0xffc5 && message[1] === 1) ws.send(Buffer.concat([Buffer.from([0, 0, 0, 2]), rectangle(0, 0, 400, 300, -223, Buffer.alloc(0)), rectangle(0, 0, 400, 300, 0, Buffer.alloc(400 * 300 * 4))]))
        }
        if (type === 5) { events.push({ kind: 'pointer', buttons: message[1], x: message.readUInt16BE(2), y: message.readUInt16BE(4) }); if (message[1] === 1) { const pixel = Buffer.alloc(4); pixel.writeUInt32LE(255 << shifts[0]); ws.send(Buffer.concat([Buffer.from([0, 0, 0, 1]), rectangle(0, 0, 1, 1, 0, pixel)])) } }
      }
    }
  })
}
sockets.on('connection', rfbConnection)
const tcpSockets = new Set()
const tcp = createTCPServer((socket) => { tcpSockets.add(socket); socket.on('close', () => tcpSockets.delete(socket)); socket.on('error', () => socket.destroy()); rfbConnection({ send: (data) => socket.write(data), close: () => socket.destroy(), on: (_event, listener) => socket.on('data', listener) }) })
tcp.listen(5194, '127.0.0.1')
console.log('Desktop fixture: http://127.0.0.1:5191/scripts/desktop/fixture.html')
const close = async () => { for (const ws of sockets.clients) ws.terminate(); sockets.close(); for (const socket of tcpSockets) socket.destroy(); tcp.close(); await vite.close(); process.exit(0) }
process.on('SIGINT', close); process.on('SIGTERM', close)
