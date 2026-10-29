import { IntegrationManager } from '../manager.ts'
import { IntegrationCoreClient, type IntegrationCoreConfig } from '../coreClient.ts'
import { IntegrationScheduler } from '../scheduling.ts'
import { isRecord } from '../../contracts/validation.ts'
import { integrationErrorCode, isIntegrationOperation } from '../../contracts/integrationIPC.ts'
import type { IntegrationRunContext } from '../../contracts/integrations.ts'

export class IntegrationHostRuntime {
  private manager?: IntegrationManager
  private readonly pending = new Map<string, AbortController>()
  private readonly admission = new IntegrationScheduler(64, 0, 2 * 1024 * 1024)
  private readonly send: (message: unknown) => void
  constructor(send: (message: unknown) => void) { this.send = send }

  async initialize(config: IntegrationCoreConfig) {
    if (this.manager) throw new Error('INTEGRATION_HOST_ALREADY_STARTED')
    const core = new IntegrationCoreClient(config)
    await core.supervise(process.pid)
    this.manager = new IntegrationManager(core, { ensureSupervised: async () => undefined,
      verifyLaunch: async (config, signal) => {
        const verified = await core.verifiedConfig(config.source.id, config.source.revision, signal)
        if (!verified.launch || JSON.stringify(verified.launch) !== JSON.stringify(config.launch)) throw new Error('INTEGRATION_CONFIG_CHANGED')
      },
      superviseGroup: (pid, release) => core.superviseGroup(pid, release), report:code=>this.send({type:'diagnostic',code}) })
    this.send({ type: 'ready' })
  }

  handle(value: unknown) {
    if (!isRecord(value) || !this.manager) return
    if (value.type === 'cancel' && typeof value.id === 'string') { this.pending.get(value.id)?.abort(); return }
    if (value.type === 'release' && typeof value.run === 'string') { this.manager.release(value.run); return }
    if (value.type !== 'request' || typeof value.id !== 'string' || value.id.length > 128 || this.pending.has(value.id)) return
    const id = value.id
    if (this.pending.size >= 64 || Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) {
      this.send({ type: 'result', id, error: 'INTEGRATION_QUEUE_FULL' }); return
    }
    const abort = new AbortController()
    this.pending.set(id, abort)
    void this.admission.run(0, abort.signal, async () => {
      const manager = this.manager!
      if (value.operation === 'status') return manager.status()
      if (value.operation === 'reconnect' && typeof value.source === 'string' && Number.isSafeInteger(value.revision)) return manager.reconnect(value.source, Number(value.revision), abort.signal)
      if (value.operation === 'test' && typeof value.source === 'string' && Number.isSafeInteger(value.revision)) return manager.test(value.source, Number(value.revision), abort.signal)
      if (value.operation === 'login' && typeof value.source === 'string' && Number.isSafeInteger(value.revision)) {
        return manager.login(value.source, Number(value.revision), async url => {
          abort.signal.throwIfAborted()
          this.send({ type: 'oauth_open', id, url })
        }, abort.signal)
      }
      if (value.operation === 'invalidate' && typeof value.source === 'string') return manager.invalidate(value.source)
      if (!isRecord(value.context) || !isIntegrationOperation(value.operation)) throw new Error('INTEGRATION_REQUEST_INVALID')
      const context = value.context as unknown as IntegrationRunContext
      const op = value.operation
      if (op.action === 'directory') return manager.directory(context, abort.signal,op.fingerprint)
      if (op.action === 'receipt') return manager.receipt(context,op.tool_call_id,abort.signal)
      if (op.action === 'resources') return manager.resources(context,op,abort.signal)
      if (op.action === 'read_resource') return manager.readResource(context,op,abort.signal)
      if (op.action === 'content') return manager.content(context, op.id, op.offset, abort.signal)
      if (op.action === 'skill') return manager.skill(context, op.source, op.version, op.path, op.offset, op.tool_call_id, abort.signal)
      if (op.action === 'definition') return manager.definition(context, op.source, op.revision, op.name, abort.signal)
      return manager.call(context, op.source, op.revision, op.name, op.tool_call_id, op.arguments, abort.signal)
    }).then(result => this.send({ type: 'result', id, value: result }), error => this.send({ type: 'result', id, error: integrationErrorCode(error) }))
      .finally(() => this.pending.delete(id))
  }

  async close() {
    this.admission.close()
    for (const request of this.pending.values()) request.abort()
    await this.manager?.close()
    this.manager = undefined
  }
}
