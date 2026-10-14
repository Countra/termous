// 只读图片头，避免为统计解码完整桌面像素；无法识别时明确返回未知尺寸。
export function runtimeImageDimensions(base64: string): { width: number; height: number } {
  const header = Buffer.from(base64.slice(0, 44), 'base64')
  if (header.length >= 24 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
  }
  if (header[0] === 0xff && header[1] === 0xd8) {
    const bytes = Buffer.from(base64, 'base64')
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]!
      const size = bytes.readUInt16BE(offset + 2)
      if (size < 2 || offset + 2 + size > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      offset += size + 2
    }
  }
  return { width: 0, height: 0 }
}

export function estimatedImageTokens(size: { width: number; height: number }) {
  if (!size.width || !size.height) return 1600
  // 此处只是通用瓦片估算，不冒充 Provider 的实际图片计费。
  return 85 + 170 * Math.ceil(size.width / 512) * Math.ceil(size.height / 512)
}
