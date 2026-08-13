import type { AppDataSnapshotGateway } from './runtimeGatewayContracts'

export function loadAppDataSnapshot(api: AppDataSnapshotGateway) {
  return Promise.all([
    api.settings(),
    api.terminalFonts(),
    api.codeSnippetGroups(),
    api.codeSnippets(),
    api.fileBookmarkGroups(),
    api.fileBookmarks(),
    api.localPathMappings(),
    api.hostGroups(),
    api.hostIcons(),
    api.connectionProxies(),
    api.hosts(),
    api.hostReachability(),
    api.credentials(),
    api.sessions(),
    api.fileSessions(),
    api.forwardProfiles(),
    api.forwards(),
  ])
}
