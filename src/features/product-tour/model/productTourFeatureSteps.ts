import type { ProductTourStepBlueprint } from './productTourTypes.ts'

const desktop = '[data-tour="desktop-workspace"]'
const automation = '[data-tour="automation-workspace"]'
const agent = '[data-tour="agent-workspace"]'
const account = '[data-tour="account-workspace"]'

const featureSteps: ProductTourStepBlueprint[] = [
  { id: 'desktop', route: 'remote-desktop', desktopView: 'desktops', element: desktop },
  { id: 'desktopConnect', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="topbar-connect"]', side: 'bottom', align: 'end' },
  { id: 'desktopTools', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-tools"]', fallbackElement: desktop },
  { id: 'desktopFiles', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-status"]', fallbackElement: '[data-tour="desktop-tools"]' },
  { id: 'automationEntry', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-tools"]', fallbackElement: desktop },
  { id: 'automationLibrary', route: 'remote-desktop', desktopView: 'workflow', element: automation },
  { id: 'automationEditor', route: 'remote-desktop', desktopView: 'workflow', element: '[data-tour="automation-editor"]', fallbackElement: automation },
  { id: 'automationPreview', route: 'remote-desktop', desktopView: 'workflow', element: '[data-tour="automation-preview"]', fallbackElement: automation },
  { id: 'automationHistory', route: 'remote-desktop', desktopView: 'workflow', element: '[data-tour="automation-history"]', fallbackElement: automation },
  { id: 'automationWindow', route: 'remote-desktop', desktopView: 'workflow', element: '[data-tour="automation-actions"]', fallbackElement: automation },
  { id: 'settingsModels', route: 'settings', preparation: 'settingsModels', element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-models"]' },
  { id: 'agent', route: 'agent', element: agent },
  { id: 'agentContext', route: 'agent', element: '[data-tour="agent-composer"]', fallbackElement: agent },
  { id: 'agentApproval', route: 'agent', element: agent },
  { id: 'agentWindow', route: 'agent', element: '[data-tour="agent-header"]', fallbackElement: agent },
  { id: 'account', route: 'account', element: account },
  { id: 'cloudSync', route: 'account', accountTab: 'sync', element: '[data-tour="account-sync"]', fallbackElement: account },
  { id: 'cloudSecurity', route: 'account', accountTab: 'security', element: '[data-tour="account-security"]', fallbackElement: account },
  { id: 'remoteDevices', route: 'account', accountTab: 'devices', element: '[data-tour="account-devices"]', fallbackElement: account },
  { id: 'remotePermissions', route: 'account', accountTab: 'devices', element: '[data-tour="remote-permissions"]', fallbackElement: account },
  { id: 'notifications', route: 'workbench', element: '[data-tour="notification-entry"]', side: 'bottom', align: 'end' },
]

export const productTourFeatureSteps = featureSteps.map((step) => ({ ...step, disableActiveInteraction: true }))
