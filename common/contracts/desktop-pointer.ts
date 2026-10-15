export interface DesktopPointer {
  automation_id: string
  source: 'agent' | 'mcp' | 'workflow' | 'automation'
  execution_generation: number
  display_epoch: number
  sequence: number
  x: number
  y: number
  buttons: number
  action: 'move' | 'button' | 'click' | 'wheel'
  scroll?: 'up' | 'down' | 'left' | 'right'
  occurred_at: string
}

export interface DesktopPointerControl {
  automation_id: string
  source: DesktopPointer['source']
  execution_generation: number
  expires_at: string
}

export interface DesktopPointerEvent {
  type: 'automation_pointer'
  session_id: string
  connection_generation: number
  revision: number
  snapshot?: boolean
  control?: DesktopPointerControl | null
  pointer: DesktopPointer | null
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const coordinate = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128

export function isDesktopPointer(value: unknown): value is DesktopPointer {
  if (!record(value)) return false
  return identifier(value.automation_id) && typeof value.source === 'string' && ['agent', 'mcp', 'workflow', 'automation'].includes(value.source)
    && positive(value.execution_generation) && positive(value.display_epoch) && positive(value.sequence)
    && coordinate(value.x) && coordinate(value.y) && Number.isInteger(value.buttons) && Number(value.buttons) >= 0 && Number(value.buttons) <= 7
    && typeof value.action === 'string' && ['move', 'button', 'click', 'wheel'].includes(value.action)
    && (value.scroll === undefined || (typeof value.scroll === 'string' && ['up', 'down', 'left', 'right'].includes(value.scroll)))
    && typeof value.occurred_at === 'string' && Number.isFinite(Date.parse(value.occurred_at))
}

export function isDesktopPointerEvent(value: unknown): value is DesktopPointerEvent {
  return record(value) && value.type === 'automation_pointer' && identifier(value.session_id)
    && positive(value.connection_generation) && positive(value.revision)
    && (value.snapshot === undefined || typeof value.snapshot === 'boolean')
    && (value.control === undefined || value.control === null || isDesktopPointerControl(value.control))
    && (value.pointer === null || isDesktopPointer(value.pointer))
}

export function isDesktopPointerControl(value: unknown): value is DesktopPointerControl {
  return record(value) && identifier(value.automation_id) && positive(value.execution_generation)
    && typeof value.source === 'string' && ['agent', 'mcp', 'workflow', 'automation'].includes(value.source)
    && typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at))
}
