export function binaryStringToBytes(data: string) {
  const bytes = new Uint8Array(data.length)
  for (let index = 0; index < data.length; index += 1) {
    bytes[index] = data.charCodeAt(index) & 0xff
  }
  return bytes
}

export function ensureTerminalEnter(text: string) {
  return /\r?\n$/.test(text) ? text : `${text}\r`
}
