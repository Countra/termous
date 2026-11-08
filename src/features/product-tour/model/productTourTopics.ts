import type { ProductTourStepId } from './productTourTypes.ts'

// 专题只编排步骤；定位和页面准备仍由同一套引擎负责。
export const productTourTopics = [
  { id: 'basics', version: 6, steps: ['welcome', 'vaultNav', 'hostsNav', 'topbarConnect', 'workbench', 'desktop', 'files', 'agent', 'account', 'notifications', 'settings', 'finish'] },
  { id: 'connections', version: 6, steps: ['vaultNav', 'vaultActions', 'credentialEditor', 'hostsNav', 'hostEditor', 'hostConnections', 'fileProfiles', 'topbarConnect', 'workbench', 'workbenchTools'] },
  { id: 'files', version: 5, steps: ['fileProfiles', 'files', 'filesBookmarks', 'filesLocalDirectory', 'filesTransfers', 'mounts', 'mountsRuntime', 'settingsMount'] },
  { id: 'desktop', version: 6, steps: ['desktop', 'desktopConnect', 'desktopTools', 'desktopFiles', 'desktopQuality', 'settingsDesktop', 'automationEntry'] },
  { id: 'automation', version: 6, steps: ['automationEntry', 'automationLibrary', 'automationEditor', 'automationPreview', 'automationAnalysis', 'automationExchange', 'automationHistory', 'automationWindow'] },
  { id: 'agent', version: 6, steps: ['settingsModels', 'settingsAgent', 'agentHostDesktop', 'agent', 'agentContext', 'agentWorkspace', 'agentExtensions', 'agentApproval', 'agentWindow', 'audit'] },
  { id: 'extensions', version: 6, steps: ['extensionsMcp', 'extensionsInstallation', 'extensionsSkills', 'extensionsSearch', 'settingsNetwork', 'agentExtensions'] },
  { id: 'cloud', version: 5, steps: ['account', 'cloudSync', 'cloudSecurity', 'settingsData'] },
  { id: 'remote', version: 6, steps: ['account', 'remoteDevices', 'remotePermissions', 'notifications'] },
  { id: 'tools', version: 6, steps: ['workbenchTools', 'forwards', 'snippets', 'settingsTerminal', 'settingsMcp', 'settingsSkills', 'audit'] },
] as const satisfies readonly { id: string; version: number; steps: readonly ProductTourStepId[] }[]

export type ProductTourTopicId = typeof productTourTopics[number]['id']

export function getProductTourTopic(id: ProductTourTopicId) {
  return productTourTopics.find((topic) => topic.id === id)!
}
