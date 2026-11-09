export function desktopControlLabel(source: string, active = true): string {
  if (!active) return 'remoteDesktop.automation.observing'
  return source === 'agent' ? 'remoteDesktop.automation.aiControlling'
    : source === 'workflow' ? 'remoteDesktop.automation.workflowControlling'
      : source === 'remote' ? 'remoteDesktop.automation.remoteControlling'
        : source === 'mcp' ? 'remoteDesktop.automation.mcpControlling'
          : source === 'local' ? 'remoteDesktop.automation.localControlling' : 'remoteDesktop.automation.active'
}

export function desktopControlBadgeLabel(source: string): string {
  return source === 'agent' ? 'remoteDesktop.automation.badge.agent'
    : source === 'mcp' ? 'remoteDesktop.automation.badge.mcp'
      : source === 'workflow' ? 'remoteDesktop.automation.badge.workflow'
        : source === 'remote' ? 'remoteDesktop.automation.badge.remote'
          : 'remoteDesktop.automation.badge.local'
}
