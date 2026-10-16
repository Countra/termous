import { isAgentDetachedCommand, isAgentDetachedBinary } from '#common/contracts'

export interface DetachedModuleRegistration {
  type: string
  title: string
  instance: string
  requiresHost: boolean
  size?: { width: number; height: number; minWidth: number; minHeight: number }
  validateCommand: (payload: unknown) => boolean
  validateBinary: (payload: unknown) => boolean
}

export const detachedModules: readonly DetachedModuleRegistration[] = [{
  type: 'agent', instance: 'workspace', title: 'Termous · AI', requiresHost: true,
  size: { width: 1100, height: 800, minWidth: 480, minHeight: 520 },
  validateCommand: isAgentDetachedCommand, validateBinary: isAgentDetachedBinary,
}]
