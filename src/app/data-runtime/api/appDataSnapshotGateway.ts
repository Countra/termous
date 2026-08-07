import type { TermousApi } from './runtimeApi'

export function loadAppDataSnapshot(api: TermousApi) {
  return Promise.all([
    api.settings(),
    api.terminalFonts(),
    api.codeSnippetGroups(),
    api.codeSnippets(),
    api.fileBookmarkGroups(),
    api.fileBookmarks(),
    api.localPathMappings(),
    api.hostGroups(),
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
