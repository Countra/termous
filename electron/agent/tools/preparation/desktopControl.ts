import { isRecord } from '../../contracts/validation.ts'
import { delay, fail, item, type Arguments, type PreparationContext } from './contracts.ts'

export async function controlGrant(ctx: PreparationContext, attachment: Arguments): Promise<Arguments> {
  if (isRecord(attachment.grant) && Date.parse(String(attachment.grant.expires_at)) > Date.now() && Date.parse(String(attachment.grant.idle_expires_at)) > Date.now()) return attachment.grant
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    const result = await ctx.invoke('termous.desktops.control.acquire', { attachment_id: attachment.id }, 'desktop_control')
    const control = item(result.control, 'control')
    if (isRecord(control.attachment) && isRecord(control.attachment.grant)) return control.attachment.grant
    const approval = isRecord(control.approval) ? control.approval : undefined
    if (approval && ['rejected', 'expired', 'cancelled'].includes(String(approval.state))) {
      fail('AGENT_CONTROL_APPROVAL_STOPPED', 'Control approval ended without permission. Stop control requests in this execution; observation and original-result queries remain available.', 'user_action', { approval_id: approval.id, state: approval.state })
    }
    if (approval?.state === 'dispatch_conflict') {
      fail(typeof approval.error_code === 'string' && approval.error_code ? approval.error_code : 'AGENT_CONTROL_ACQUISITION_FAILED',
        typeof approval.error_message === 'string' && approval.error_message ? approval.error_message : 'Control acquisition failed after approval.',
        'user_action', { approval_id: approval.id, state: approval.state })
    }
    if (approval?.state === 'approved') {
      fail('AGENT_CONTROL_GRANT_UNAVAILABLE', 'The approval has completed but its control grant is no longer available. Read the current attachment; this approval cannot be approved again.', 'reread', { approval_id: approval.id, state: approval.state })
    }
    if (!approval || !['pending', 'dispatching'].includes(String(approval.state))) {
      fail('AGENT_TOOL_RESPONSE_INVALID', 'The control request returned no valid approval state.', 'user_action')
    }
    if (Date.now() >= deadline) {
      fail('AGENT_CONTROL_APPROVAL_REQUIRED', 'Control is not granted. Resolve the existing approval; do not submit another request.', 'approval', { approval_id: approval.id, state: approval.state })
    }
    await delay(ctx.signal)
  }
}
