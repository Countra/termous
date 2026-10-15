import type { AppLanguage, AppTheme } from './application'
import type { DesktopPointerEvent } from './desktop-pointer.ts'

export interface DesktopAutomationHost {
  id: string
  session_id: string
  generation: number
  name: string
  state: string
  show_sequence: number
}

export interface DesktopAutomationBootstrap {
  host: DesktopAutomationHost
  language: AppLanguage
  theme: AppTheme
  shared: boolean
  streamURL: string
  credentialAvailable: boolean
}

// 宿主只能访问自己的会话；接口不接受路径、URL、全局令牌或任意脚本。
export interface DesktopAutomationBridge {
  pointer(): Promise<DesktopPointerEvent | null>
  onPointer(listener: (event: DesktopPointerEvent) => void): () => void
  bootstrap(): Promise<DesktopAutomationBootstrap>
  credentials(): Promise<{ password: string }>
  executor(): Promise<{ url: string; ticket: string }>
  state(state: 'waiting_user_action' | 'preparing' | 'failed'): Promise<void>
}
