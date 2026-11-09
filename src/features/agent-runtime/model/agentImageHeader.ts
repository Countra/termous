// 只读取压缩文件头，先限制像素总量，再允许浏览器建立解码资源。
export function agentImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === 'image/png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) }
  if (mime === 'image/jpeg') {
    let offset = 2
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) return undefined
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === undefined || marker === 0xda || marker === 0xd9) return undefined
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 2 > bytes.length) return undefined
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return undefined
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return undefined
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
      }
      offset += length
    }
  }
  if (mime === 'image/webp') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4))
      const length = view.getUint32(offset + 4, true)
      offset += 8
      if (offset + length > bytes.length) return undefined
      if (tag === 'VP8X' && length >= 10) return {
        width: 1 + bytes[offset + 4]! + (bytes[offset + 5]! << 8) + (bytes[offset + 6]! << 16),
        height: 1 + bytes[offset + 7]! + (bytes[offset + 8]! << 8) + (bytes[offset + 9]! << 16),
      }
      if (tag === 'VP8L' && length >= 5 && bytes[offset] === 0x2f) {
        const packed = view.getUint32(offset + 1, true)
        return { width: 1 + (packed & 0x3fff), height: 1 + ((packed >>> 14) & 0x3fff) }
      }
      if (tag === 'VP8 ' && length >= 10 && bytes[offset + 3] === 0x9d && bytes[offset + 4] === 0x01 && bytes[offset + 5] === 0x2a) {
        return { width: view.getUint16(offset + 6, true) & 0x3fff, height: view.getUint16(offset + 8, true) & 0x3fff }
      }
      offset += length + (length % 2)
    }
  }
  return undefined
}
