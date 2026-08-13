export const maximumMcpClientNameBytes = 80

export function mcpClientNameBytes(value: string) {
  return new TextEncoder().encode(value.trim()).byteLength
}

export function isValidMcpClientName(value: string) {
  const bytes = mcpClientNameBytes(value)
  return bytes > 0 && bytes <= maximumMcpClientNameBytes
}
