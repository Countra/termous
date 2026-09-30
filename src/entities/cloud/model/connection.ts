/** 云连接故障可恢复，不代表账号退出或设备授权失效。 */
export function isCloudConnectionError(code?: string): boolean {
  return code !== undefined && ['network_unavailable', 'response_incomplete', 'service_unavailable', 'rate_limited'].includes(code)
}
