import type { McpApproval } from '#entities/mcp-access'
import { ApprovalTargets } from './ApprovalDetailFields'
import { CommandApprovalRenderer } from './CommandApprovalRenderer'
import { ForwardingApprovalRenderer } from './ForwardingApprovalRenderer'
import { RemoteOpsApprovalRenderer } from './RemoteOpsApprovalRenderer'
import { SnippetApprovalRenderer } from './SnippetApprovalRenderer'
import { FilesApprovalRenderer } from './FilesApprovalRenderer'
import { DesktopApprovalRenderer } from './DesktopApprovalRenderer'
import { WorkflowApprovalRenderer } from './WorkflowApprovalRenderer'
import { AnalysisApprovalRenderer } from './AnalysisApprovalRenderer'
import { ExternalApprovalRenderer } from './ExternalApprovalRenderer'

export function McpApprovalDetails({ approval }: { approval: McpApproval }) {
  if (approval.kind==='external_tool') return <ExternalApprovalRenderer operation={approval.operation}/>
  return (
    <>
      {approval.kind === 'screen_analysis' ? <AnalysisApprovalRenderer operation={approval.operation} /> : approval.kind === 'desktop_workflow' ? <WorkflowApprovalRenderer operation={approval.operation} /> : approval.kind === 'desktop' ? <DesktopApprovalRenderer operation={approval.operation} /> : approval.kind === 'files' ? (
        <FilesApprovalRenderer operation={approval.operation} />
      ) : approval.kind === 'remoteops' ? (
        <RemoteOpsApprovalRenderer operation={approval.operation} />
      ) : approval.kind === 'forwarding' ? (
        <ForwardingApprovalRenderer operation={approval.operation} />
      ) : approval.kind === 'snippet' ? (
        <SnippetApprovalRenderer operation={approval.operation} />
      ) : (
        <CommandApprovalRenderer command={approval.command} />
      )}
      <ApprovalTargets targets={approval.targets} />
    </>
  )
}
