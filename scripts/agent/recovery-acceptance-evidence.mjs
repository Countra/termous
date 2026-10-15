// 同一模型请求可能包含多个顺序执行的工具，不能把同轮正确核验误算为没有恢复。
export function recoveryEvidence(result, oldID, sessions) {
  const failedIndex = result.calls.findIndex((call) => call.name === 'termous.desktops.get' && call.args.session_id === oldID && call.error_code === 'REMOTE_DESKTOP_SESSION_NOT_FOUND')
  const failed = result.calls[failedIndex]
  const following = failed ? result.calls.slice(failedIndex + 1) : []
  const corrected = following.find((call) => call.failed === false && (call.name === 'discover_tools' && call.discovered_tools?.includes('termous.desktops.connect')
    || call.name === 'termous.desktops.connect' || call.name === 'termous.desktops.get' && sessions.some((session) => session.id === call.verified_session)))
  const repeated = following.filter((call) => call.name === failed.name && call.args.session_id === oldID).length
  const requests = corrected ? corrected.request - failed.request : null
  const verified = result.calls.some((call) => call.name === 'termous.desktops.get' && call.failed === false
    && sessions.some((session) => session.id === call.verified_session && !['failed', 'closed', 'stopping'].includes(session.status)))
  return { success: result.status === 'completed' && requests !== null && requests >= 0 && requests <= 2 && repeated === 0 && verified,
    recovery_requests: requests, recovery_mode: requests === 0 ? 'same-request-verification' : requests === null ? 'not-observed' : 'next-request-recovery',
    repeated_calls: repeated, discovery_calls: result.calls.filter((call) => call.name === 'discover_tools').length,
    actual_sessions: sessions.map(({ id, status, connection_generation }) => ({ id, status, connection_generation })) }
}
