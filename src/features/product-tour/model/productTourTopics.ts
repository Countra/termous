import type { ProductTourStepId } from './productTourTypes.ts'

// 专题只编排步骤；定位和页面准备仍由同一套引擎负责。
export const productTourTopics = [
  { id: 'basics', steps: ['welcome', 'vaultNav', 'hostsNav', 'topbarConnect', 'workbench', 'desktop', 'files', 'agent', 'account', 'notifications', 'settings', 'finish'] },
  { id: 'connections', steps: ['vaultNav', 'vaultActions', 'credentialEditor', 'hostsNav', 'hostEditor', 'hostConnections', 'fileProfiles', 'topbarConnect', 'workbench', 'workbenchTools'] },
  { id: 'files', steps: ['fileProfiles', 'files', 'filesBookmarks', 'filesLocalDirectory', 'filesTransfers', 'mounts', 'mountsRuntime', 'settingsMount'] },
  { id: 'desktop', steps: ['desktop', 'desktopConnect', 'desktopTools', 'desktopFiles', 'automationEntry'] },
  { id: 'automation', steps: ['automationEntry', 'automationLibrary', 'automationEditor', 'automationPreview', 'automationHistory', 'automationWindow'] },
  { id: 'agent', steps: ['settingsModels', 'settingsAgent', 'agent', 'agentContext', 'agentApproval', 'agentWindow', 'audit'] },
  { id: 'cloud', steps: ['account', 'cloudSync', 'cloudSecurity', 'settingsData'] },
  { id: 'remote', steps: ['account', 'remoteDevices', 'remotePermissions', 'notifications'] },
  { id: 'tools', steps: ['workbenchTools', 'forwards', 'snippets', 'settingsTerminal', 'settingsMcp', 'settingsSkills', 'audit'] },
] as const satisfies readonly { id: string; steps: readonly ProductTourStepId[] }[]

export type ProductTourTopicId = typeof productTourTopics[number]['id']

export function getProductTourTopic(id: ProductTourTopicId) {
  return productTourTopics.find((topic) => topic.id === id)!
}
