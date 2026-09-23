import type { MountInstance } from './types.ts'

export const isMountActive = (value: MountInstance) => value.mounted || value.retained || value.state === 'starting'
export const isMountBusy = (value: MountInstance) => value.state === 'starting' || ['syncing', 'connecting', 'unmounting', 'cancelling'].includes(value.phase)

export function decodeMountEvent(value: unknown): MountInstance[] {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'snapshot'
    || !('instances' in value) || !Array.isArray(value.instances)) throw new Error('Invalid mount snapshot')
  for (const item of value.instances) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string'
      || !['starting', 'running', 'failed', 'stopped'].includes(item.state)
      || typeof item.mounted !== 'boolean' || typeof item.retained !== 'boolean'
      || typeof item.dirty_nodes !== 'number' || typeof item.open_handles !== 'number') throw new Error('Invalid mount instance')
  }
  return value.instances as MountInstance[]
}
