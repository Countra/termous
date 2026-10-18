import type { AgentArchiveManager, AgentWorkspaceProps } from '#widgets/agent-workspace'
import type { ComponentProps } from 'react'
import type { AgentReadinessSurface } from '../../ui/AgentReadinessSurface.tsx'
import type { AgentTerminalReferenceImportNotice } from '../../ui/AgentTerminalReferenceImportNotice.tsx'

export interface AgentSurfaceModel {
  workspace?: AgentWorkspaceProps
  archive?: ComponentProps<typeof AgentArchiveManager>
  readiness?: ComponentProps<typeof AgentReadinessSurface>
  reference?: ComponentProps<typeof AgentTerminalReferenceImportNotice>
  warning?: 'setup' | 'reconnecting' | 'degraded'
  onRetry?: () => void
  onRefreshSetup?: () => void
}
