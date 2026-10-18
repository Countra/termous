import { useEffect, useRef } from 'react'
import type { CloudAccountArea, CloudAccountChange } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'

// 只订阅固定账号区域；回调负责补读，通知不能批准设备或重放业务操作。
export function useCloudChanges(api: CloudGateway, generation: string, areas: readonly CloudAccountArea[], reload: (change: CloudAccountChange) => unknown, operationId?: string) {
  const latest = useRef(reload)
  useEffect(() => { latest.current = reload }, [reload])
  const key = areas.join(',')
  useEffect(() => api.subscribeChanges?.(change => {
    if (change.generation !== generation || api.getStatus()?.generation !== generation) return
    if (!change.changes.some(area => key.split(',').includes(area))) return
    // 全局权限变化也会使当前操作失效，不能因为批次携带另一个操作 ID 而跳过补读。
    if (operationId && change.operations.length && !change.operations.includes(operationId) && change.changes.every(area => area === 'authorizations')) return
    void latest.current(change)
  }), [api, generation, key, operationId])
}
