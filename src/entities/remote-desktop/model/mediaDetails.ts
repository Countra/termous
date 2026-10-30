import type { DesktopMediaSnapshot, H264ReceiverState } from '@termous/remote-protocol/desktop'
import type { PresentationState } from '@termous/remote-protocol/presentation'

export interface RemoteDesktopMediaDetails {
  connectionId: string
  title: string
  transport: 'h264' | 'rfb'
  phase: string
  presentation?: PresentationState
  receiver?: H264ReceiverState
  sample?: DesktopMediaSnapshot
}

export type RemoteDesktopMediaChanged = (key: string, details?: RemoteDesktopMediaDetails) => void
