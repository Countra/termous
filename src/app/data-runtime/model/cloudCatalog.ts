import type { AppDataSnapshotGateway } from '../api/runtimeGatewayContracts'
import type { AppData } from './appData'

const fields = {
  connection_proxies: ['connectionProxies'], host_groups: ['hostGroups'], host_icons: ['hostIcons'], credentials: ['credentials'],
  hosts: ['hostAssets', 'hosts'], ssh_access_profiles: ['sshAccessProfiles', 'hosts'], file_access_profiles: ['fileAccessProfiles'],
  terminal_fonts: ['terminalFonts'], code_snippet_groups: ['codeSnippetGroups'], code_snippets: ['codeSnippets'],
  file_bookmark_groups: ['fileBookmarkGroups'], file_bookmarks: ['fileBookmarks'], forward_profiles: ['forwardProfiles'],
  remote_desktop_profiles: ['remoteDesktopProfiles'], remote_desktop_credential_bindings: ['remoteDesktopProfiles'],
  // 改名预设由功能 Gateway 接收失效提示后读取，不驻留在应用目录快照中。
  file_rename_presets: [],
} as const

export const cloudDatasets = Object.keys(fields)
export async function loadCloudCatalog(api: AppDataSnapshotGateway, datasets: readonly string[]): Promise<Partial<AppData>> {
  const keys = new Set(datasets.flatMap((dataset) => dataset in fields ? [...fields[dataset as keyof typeof fields]] : []))
  const entries = await Promise.all([...keys].map(async (key) => [key, await api[key]()] as const))
  return Object.fromEntries(entries)
}

export function mergeCloudCatalog(current: AppData, before: AppData, patch: Partial<AppData>): AppData {
  const accepted: Partial<AppData> = {}
  for (const key of Object.keys(patch) as (keyof AppData)[]) {
    // 请求期间发生的本地修改优先；相同数据保留引用，避免扰动选择和编辑草稿。
    if (current[key] !== before[key] || JSON.stringify(current[key]) === JSON.stringify(patch[key])) continue
    Object.assign(accepted, { [key]: patch[key] })
  }
  return Object.keys(accepted).length ? { ...current, ...accepted } : current
}
