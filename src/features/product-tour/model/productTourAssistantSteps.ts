import type { ProductTourStepBlueprint } from './productTourTypes.ts'

const agent = '[data-tour="agent-workspace"]'
const settings = '[role="tabpanel"][aria-hidden="false"]'
const extensions = `${settings} [data-tour="settings-extensions"]`

// 助手与扩展共用步骤，专题仅决定讲解顺序。
export const productTourAssistantSteps: ProductTourStepBlueprint[] = [
  { id: 'settingsModels', route: 'settings', preparation: 'settingsModels', element: `${settings} [data-tour="settings-models"]` },
  { id: 'agentHostDesktop', route: 'settings', preparation: 'settingsAgent', element: `${settings} [data-tour="agent-host-desktop"]`, fallbackElement: `${settings} [data-tour="settings-agent"]` },
  { id: 'agent', route: 'agent', element: agent },
  { id: 'agentContext', route: 'agent', element: '[data-tour="agent-composer"]', fallbackElement: agent },
  { id: 'agentWorkspace', route: 'agent', element: '[data-tour="agent-local-workspace"]', fallbackElement: agent },
  { id: 'agentExtensions', route: 'agent', element: '[data-tour="agent-extensions"]', fallbackElement: agent },
  { id: 'agentApproval', route: 'agent', element: agent },
  { id: 'agentWindow', route: 'agent', element: '[data-tour="agent-window"]', fallbackElement: agent },
  { id: 'extensionsMcp', route: 'settings', preparation: 'extensionsMcp', element: `${extensions} [data-tour="extensions-mcp"]`, fallbackElement: extensions },
  { id: 'extensionsInstallation', route: 'settings', preparation: 'extensionsMcp', element: `${extensions} [data-tour="extensions-installation"]`, fallbackElement: extensions },
  { id: 'extensionsSkills', route: 'settings', preparation: 'extensionsSkills', element: `${extensions} [data-tour="extensions-skill"]`, fallbackElement: extensions },
  { id: 'extensionsSearch', route: 'settings', preparation: 'extensionsSearch', element: `${extensions} [data-tour="extensions-search"]`, fallbackElement: extensions },
  { id: 'settingsNetwork', route: 'settings', preparation: 'settingsConnection', element: `${settings} [data-tour="settings-network"]`, fallbackElement: `${settings} [data-tour="settings-connection"]` },
]
