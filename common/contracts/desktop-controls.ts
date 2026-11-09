import type { AppLanguage, AppTheme } from './application'
import { isHostDesktopTarget, type HostDesktopTarget } from './desktop-target.ts'

export type DesktopControlTarget = HostDesktopTarget | {
  kind: 'protocol_session'
  protocol: { session_id: string; connection_generation: number; execution_generation?: number }
}
export interface DesktopControlPresentation {
  target: DesktopControlTarget
  reference: string
  source: string
  name: string
  active: boolean
}
export interface DesktopControlSnapshot { instance_id: string; controls: DesktopControlPresentation[] }
export interface DesktopControlReclaim { instance_id: string; target: DesktopControlTarget; reference: string }
export interface DesktopControlsGateway {
  subscribe(listener: (snapshot: DesktopControlSnapshot | null) => void): () => void
  reclaim(request: DesktopControlReclaim): Promise<void>
}
export interface DesktopIndicatorState {
  revision: number
  role: 'badge' | 'bar'
  theme: AppTheme
  language: AppLanguage
  control: DesktopControlPresentation | null
  instance_id: string
}
// 浮层没有通用请求或输入能力；收回只能引用它已看到的当前状态。
export interface DesktopIndicatorBridge {
  state(): Promise<DesktopIndicatorState>
  subscribe(listener: (state: DesktopIndicatorState) => void): () => void
  reclaim(request: DesktopControlReclaim): Promise<void>
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length <= max
export function isDesktopControlTarget(value: unknown): value is DesktopControlTarget {
  if (isHostDesktopTarget(value)) return true
  if (!record(value) || value.kind !== 'protocol_session' || !record(value.protocol)) return false
  const p = value.protocol
  return text(p.session_id, 128) && p.session_id.length > 0 && Number.isSafeInteger(p.connection_generation) && Number(p.connection_generation) > 0
    && (p.execution_generation === undefined || Number.isSafeInteger(p.execution_generation) && Number(p.execution_generation) >= 0)
}
export function isDesktopControlReclaim(value: unknown): value is DesktopControlReclaim {
  return record(value) && text(value.instance_id, 128) && value.instance_id.length > 0
    && text(value.reference, 64) && /^[a-f0-9]{64}$/.test(value.reference) && isDesktopControlTarget(value.target)
}
export function isDesktopControlSnapshot(value: unknown): value is DesktopControlSnapshot {
  return record(value) && text(value.instance_id, 128) && value.instance_id.length > 0
    && Array.isArray(value.controls) && value.controls.length <= 1024 && value.controls.every(c => record(c)
      && isDesktopControlReclaim({ ...c, instance_id: value.instance_id }) && text(c.source, 128) && text(c.name) && typeof c.active === 'boolean')
}
export function sameDesktopControl(request: DesktopControlReclaim, snapshot: DesktopControlSnapshot): boolean {
  return request.instance_id === snapshot.instance_id && snapshot.controls.some(c => c.reference === request.reference
    && desktopControlTargetKey(c.target) === desktopControlTargetKey(request.target))
}
export function desktopControlTargetKey(t: DesktopControlTarget): string {
  return t.kind === 'host_desktop' ? JSON.stringify([t.kind, t.instance_id, t.host.kind, t.host.id, t.host.generation])
    : JSON.stringify([t.kind, t.protocol.session_id, t.protocol.connection_generation, t.protocol.execution_generation ?? 0])
}
