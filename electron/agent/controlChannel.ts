import type { AgentRuntimeCommandResult } from '#common/contracts'
import type { AgentCoreRuntimePort, AgentSupervisorLease } from './coreRuntimeClient.ts'
import type { AgentControlCommand, AgentControlIdentity } from './controlProtocol.ts'
export type { AgentControlCommand } from './controlProtocol.ts'

// 控制通道独立于 Renderer；等待插入消息回执不能阻塞后续停止指令或租约续期。
export class AgentControlChannel {
  private abort: AbortController | null = null
  private identity: AgentControlIdentity | null = null
  private readonly core: Pick<AgentCoreRuntimePort, 'pollControl' | 'ackControl'>
  private readonly execute: (command: AgentControlCommand) => Promise<AgentRuntimeCommandResult>
  constructor(core: Pick<AgentCoreRuntimePort, 'pollControl' | 'ackControl'>, execute: (command: AgentControlCommand) => Promise<AgentRuntimeCommandResult>) {
    this.core = core
    this.execute = execute
  }

  attach(lease: AgentSupervisorLease) {
    if (!this.core.pollControl || !this.core.ackControl) return
    if (this.identity?.core_instance_id === lease.core_instance_id && this.identity.supervisor_instance_id === lease.supervisor_instance_id) return
    this.close()
    const identity = { core_instance_id: lease.core_instance_id, supervisor_instance_id: lease.supervisor_instance_id }
    const abort = new AbortController()
    this.identity = identity
    this.abort = abort
    void this.run(identity, abort.signal)
  }
  close() {
    this.abort?.abort()
    this.abort = null
    this.identity = null
  }
  private async run(identity: AgentControlIdentity, signal: AbortSignal) {
    let active = 0
    while (!signal.aborted) {
      try {
        const command = await this.core.pollControl!(identity, signal)
        if (!command || signal.aborted) continue
        if (active >= 4 && command.action !== 'stop') {
          await this.ack(identity, command.id, { accepted: false, error_code: 'AGENT_RUNTIME_BUSY' }, signal)
          continue
        }
        active++
        void (async () => {
          try {
            const result = await this.execute(command)
            await this.ack(identity, command.id, result, signal)
          } catch {
            // 异常不能当作未执行；Go 保留 started 账本，控制端补读权威状态。
            await this.ack(identity, command.id, { accepted: false, error_code: 'AGENT_RUNTIME_CONTROL_UNCERTAIN' }, signal)
          } finally { active-- }
        })()
      } catch {
        if (!signal.aborted) await pause(signal, 1000)
      }
    }
  }
  private async ack(identity: AgentControlIdentity, id: string, result: Pick<AgentRuntimeCommandResult, 'accepted' | 'error_code'>, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      try {
        await this.core.ackControl!({ ...identity, id, accepted: result.accepted, error_code: result.error_code }, signal)
        return
      } catch { await pause(signal, 300 * (attempt + 1)) }
    }
  }
}

function pause(signal: AbortSignal, delay: number) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, delay)
    timer.unref()
    signal.addEventListener('abort', finish, { once: true })
  })
}
