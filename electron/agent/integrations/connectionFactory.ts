import { McpClient, StreamableHttpTransport, type McpTransport } from '@earendil-works/pi-mcp'
import type { IntegrationHostConfig } from '../contracts/integrations.ts'
import type { IntegrationConnection, IntegrationConnectionOptions } from './connectionTypes.ts'
import { IntegrationScheduler } from './scheduling.ts'
import { IntegrationHTTPBoundary, integrationMessageLimit } from './httpBoundary.ts'
import { integrationEnvironment } from './environment.ts'
import { SupervisedStdioTransport } from './stdioTransport.ts'
import { integrationNetwork, applyIntegrationProxy } from './network.ts'
import { readDirectory } from './directory.ts'
import { IntegrationFailure, integrationDiagnostic, redactIntegrationDetail } from './diagnostics.ts'
import { integrationConnectionError } from './connectionErrors.ts'

export async function openIntegrationConnection(key: string, config: IntegrationHostConfig, signal: AbortSignal,
  options: IntegrationConnectionOptions, phase: (value: 'handshaking' | 'listing') => void): Promise<IntegrationConnection> {
  const settings = config.source.mcp
  if (!settings) throw new Error('INTEGRATION_CONFIG_INVALID')
  const generation = crypto.randomUUID()
  const managed = Boolean(config.candidate_id || settings.dependency_id)
  let leased = false
  let transport: McpTransport | undefined
  let network: ReturnType<typeof integrationNetwork> | undefined
  const timeout = (config.configuration?.settings.startup_timeout_seconds ?? 120) * 1000
  const client = new McpClient({ name: 'termous-integrations', version: '1.0.0', capabilities: {}, requestTimeoutMs: timeout })
  const abort = () => { void client.close().catch(() => options.report?.('INTEGRATION_INITIALIZATION_CLOSE_FAILED')) }
  signal.addEventListener('abort', abort, { once: true })
  const close = async () => {
    // 不能在进程退出尚未确认时释放安装引用；由宿主进程监督继续持有。
    try {
      await client.close()
      await transport?.close()
      if (leased) { await options.installationLease!(config, generation, true); leased = false }
    } finally { await network?.close() }
  }
  try {
    signal.throwIfAborted()
    if (managed) {
      if (!options.installationLease) throw new Error('INTEGRATION_INSTALLATION_LEASE_UNAVAILABLE')
      await options.installationLease(config, generation, false); leased = true
    }
    await options.verifyLaunch?.(config, signal)
    signal.throwIfAborted()
    if (settings.transport === 'stdio') {
      if ((managed || settings.mode === 'managed_npm') && (!config.launch || !options.verifyLaunch)) throw new Error('INTEGRATION_DEPENDENCY_NOT_READY')
      await options.ensureSupervised()
      signal.throwIfAborted()
      transport = new SupervisedStdioTransport({ command: config.launch?.command ?? settings.command!, args: config.launch?.args ?? settings.args, cwd: settings.cwd,
        inheritEnv: false, env: applyIntegrationProxy(integrationEnvironment(options.environment ?? process.env, config.secret.environment), config.configuration?.network),
        stderr: 'pipe', maxStderrBytes: 32 * 1024, maxMessageBytes: integrationMessageLimit }, options.superviseGroup)
    } else {
      network = integrationNetwork(config.configuration?.network, options.fetch)
      const boundary = new IntegrationHTTPBoundary(settings.url!, network.fetch)
      const authProvider = settings.auth === 'oauth' ? options.authProvider?.(config) : undefined
      if (settings.auth === 'oauth' && !authProvider) throw new Error('INTEGRATION_AUTH_REQUIRED')
      transport = boundary.wrap(new StreamableHttpTransport({ url: settings.url!, headers: config.secret.headers, fetch: boundary.fetch,
        authProvider, maxMessageBytes: integrationMessageLimit, reconnect: { maxRetries: 0 } }))
    }
    phase('handshaking')
    await client.connect(transport)
    signal.throwIfAborted()
    phase('listing')
    const directory = await readDirectory(client, config, signal, timeout)
    const serial = new IntegrationScheduler(1, 32, 1024 * 1024)
    const connection: IntegrationConnection = { key, generation, client, directory, serial, config,
      directoryRevision: 0, publishedRevision: 0, lastUsed: Date.now(), owners: new Set(), close: async () => { unsubscribe(); serial.close(); await close() } }
    const unsubscribe = client.onNotification('notifications/tools/list_changed', () => { connection.directoryRevision = Math.min(connection.directoryRevision + 1, Number.MAX_SAFE_INTEGER) })
    return connection
  } catch (error) {
    const diagnostic = integrationDiagnostic(integrationConnectionError(error, signal, settings.transport === 'stdio'))
    if (transport instanceof SupervisedStdioTransport && transport.stderr) diagnostic.detail = redactIntegrationDetail(transport.stderr, config.secret)
    try { await close() } catch { options.report?.('INTEGRATION_INITIALIZATION_CLOSE_FAILED') }
    throw new IntegrationFailure(diagnostic)
  } finally { signal.removeEventListener('abort', abort) }
}
