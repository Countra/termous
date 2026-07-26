const requiredProtocol = 'http:'
const requiredHostname = '127.0.0.1'

interface SimulationWebRequest {
  onBeforeRequest(
    filter: { urls: string[] },
    listener: (
      details: { url: string },
      callback: (response: { cancel?: boolean }) => void,
    ) => void,
  ): void
}

interface SimulationNetworkSession {
  setProxy(config: { mode: 'direct' }): Promise<void>
  webRequest: SimulationWebRequest
}

interface NetworkGuardOptions {
  expectedFeedURL: string
  onBlocked?(url: string): void
}

export async function installUpdateSimulationNetworkGuard(
  networkSession: SimulationNetworkSession,
  options: NetworkGuardOptions,
) {
  const expectedOrigin = requireLoopbackFeedOrigin(options.expectedFeedURL)
  await networkSession.setProxy({ mode: 'direct' })
  networkSession.webRequest.onBeforeRequest({
    urls: [
      'http://*/*',
      'https://*/*',
      'ws://*/*',
      'wss://*/*',
    ],
  }, (details, callback) => {
    const allowed = isAllowedUpdateSimulationURL(
      details.url,
      expectedOrigin,
    )
    if (!allowed) {
      options.onBlocked?.(details.url)
    }
    callback(allowed ? {} : { cancel: true })
  })
}

export function isAllowedUpdateSimulationURL(
  value: string,
  expectedFeedURL: string,
) {
  let actual: URL
  let expected: URL
  try {
    actual = new URL(value)
    expected = new URL(expectedFeedURL)
  } catch {
    return false
  }
  return (
    expected.protocol === requiredProtocol
    && expected.hostname === requiredHostname
    && expected.username === ''
    && expected.password === ''
    && actual.protocol === expected.protocol
    && actual.hostname === expected.hostname
    && actual.port === expected.port
    && actual.username === ''
    && actual.password === ''
  )
}

function requireLoopbackFeedOrigin(value: string) {
  const parsed = new URL(value)
  if (
    parsed.protocol !== requiredProtocol
    || parsed.hostname !== requiredHostname
    || !parsed.port
    || parsed.username
    || parsed.password
  ) {
    throw new Error('更新模拟只允许固定端口的 loopback HTTP 更新源')
  }
  return parsed.origin
}
