import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { skillInstallIPCChannels, type SkillInstallClient, type SkillInstallResponse } from '#common/contracts'
import type { SkillInstaller } from './installer.ts'
import { isSkillInstallClient, skillInstallError, SkillInstallFailure } from './installPaths.ts'

export function registerSkillInstallIPC(options: {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  installer: Pick<SkillInstaller, 'prepare' | 'install'>
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  pickDirectory: (event: IpcMainInvokeEvent, client: SkillInstallClient) => Promise<string | null>
}) {
  let picking = false
  const run = async <T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<SkillInstallResponse<T>> => {
    if (!options.isTrustedSender(event)) throw new Error('SKILL_INSTALL_IPC_NOT_ALLOWED')
    try { return { ok: true, value: await operation() } } catch (error) {
      return { ok: false, error: skillInstallError(error) }
    }
  }
  options.ipcMain.handle(skillInstallIPCChannels.selectDirectory, (event, client: unknown) => run(event, async () => {
    if (!isSkillInstallClient(client)) throw new SkillInstallFailure('invalid_request')
    if (picking) throw new SkillInstallFailure('busy')
    picking = true
    try {
      const directory = await options.pickDirectory(event, client)
      if (!directory) return null
      if (!options.isTrustedSender(event)) throw new SkillInstallFailure('invalid_request')
      return await options.installer.prepare(directory, client, event.sender.id)
    } finally { picking = false }
  }))
  options.ipcMain.handle(skillInstallIPCChannels.install, (event, request: unknown) => run(event, async () => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new SkillInstallFailure('invalid_request')
    const value = request as Record<string, unknown>
    if (Object.keys(value).some((key) => key !== 'plan_id' && key !== 'policy')
      || typeof value.plan_id !== 'string' || value.plan_id.length > 64 || !value.plan_id
      || (value.policy !== 'skip' && value.policy !== 'replace')) throw new SkillInstallFailure('invalid_request')
    return options.installer.install(value.plan_id, value.policy, event.sender.id)
  }))
  return () => {
    options.ipcMain.removeHandler(skillInstallIPCChannels.selectDirectory)
    options.ipcMain.removeHandler(skillInstallIPCChannels.install)
  }
}
