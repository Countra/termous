import type { McpApproval } from '#entities/mcp-access'
import { ApprovalTargets } from './ApprovalDetailFields'
import { CommandApprovalRenderer } from './CommandApprovalRenderer'
import { ForwardingApprovalRenderer } from './ForwardingApprovalRenderer'
import { RemoteOpsApprovalRenderer } from './RemoteOpsApprovalRenderer'
import { SnippetApprovalRenderer } from './SnippetApprovalRenderer'
import { FilesApprovalRenderer } from './FilesApprovalRenderer'

export function McpApprovalDetails({ approval }: { approval: McpApproval }) {
  return (
    <>
      {approval.kind === 'files' ? (
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
