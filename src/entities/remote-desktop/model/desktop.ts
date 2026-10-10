export interface DesktopControl {
  id: string
  owner: string
  generation: number
  expires_at: string
}
export interface DesktopState {
  available: boolean
  reason?: string
  connection_generation: number
  display_epoch: number
  frame_sequence: number
  width: number
  height: number
  capabilities: { screenshot: boolean; pointer: boolean; keyboard: boolean; text: boolean }
  control?: DesktopControl
}
export interface DesktopRegion { x: number; y: number; width: number; height: number }
export interface DesktopScreenshotRequest {
  expected_connection_generation: number
  display_epoch: number
  after_sequence: number
  region?: DesktopRegion
  max_width: number
  max_height: number
}
export interface DesktopSnapshotMetadata {
  connection_generation: number
  display_epoch: number
  frame_sequence: number
  desktop_width: number
  desktop_height: number
  region: DesktopRegion
  width: number
  height: number
  captured_at: string
}
export interface DesktopOperation {
  kind: 'move' | 'button' | 'click' | 'wheel' | 'key' | 'shortcut' | 'text'
  x?: number
  y?: number
  button?: 'left' | 'middle' | 'right'
  down?: boolean
  delta?: number
  horizontal?: boolean
  code?: string
  codes?: string[]
  text?: string
}
export interface DesktopInput {
  expected_connection_generation: number
  lease_id: string
  control_generation: number
  sequence: number
  display_epoch: number
  operation: DesktopOperation
}
