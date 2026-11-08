import type { ProductTourStepBlueprint } from './productTourTypes.ts'
import { productTourAssistantSteps } from './productTourAssistantSteps.ts'

const desktop = '[data-tour="desktop-workspace"]'
const automation = '[data-tour="automation-workspace"]'
const account = '[data-tour="account-workspace"]'

const featureSteps: ProductTourStepBlueprint[] = [
  { id: 'desktop', route: 'remote-desktop', desktopView: 'desktops', element: desktop },
  { id: 'desktopConnect', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="topbar-connect"]', side: 'bottom', align: 'end' },
  { id: 'desktopTools', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-tools"]', fallbackElement: desktop },
  { id: 'desktopFiles', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-status"]', fallbackElement: '[data-tour="desktop-tools"]' },
  { id: 'desktopQuality', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-quality"]', fallbackElement: desktop },
  { id: 'settingsDesktop', route: 'settings', preparation: 'settingsDesktop', element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-remote-desktop"]' },
  { id: 'automationEntry', route: 'remote-desktop', desktopView: 'desktops', element: '[data-tour="desktop-tools"]', fallbackElement: desktop },
  { id: 'automationLibrary', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'scripts', element: '[data-tour="automation-library"]', fallbackElement: automation },
  { id: 'automationEditor', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'scripts', element: '[data-tour="automation-editor"]', fallbackElement: automation },
  { id: 'automationPreview', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'scripts', element: '[data-tour="automation-preview"]', fallbackElement: automation },
  { id: 'automationAnalysis', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'scripts', element: '[data-tour="automation-analysis"]', fallbackElement: automation },
  { id: 'automationExchange', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'scripts', element: '[data-tour="automation-functions"]', fallbackElement: '[data-tour="automation-import"]' },
  { id: 'automationHistory', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'runs', element: '[data-tour="automation-history"]', fallbackElement: automation },
  { id: 'automationWindow', route: 'remote-desktop', desktopView: 'workflow', workflowView: 'scripts', element: '[data-tour="automation-window"]', fallbackElement: automation },
  ...productTourAssistantSteps,
  { id: 'account', route: 'account', element: account },
  { id: 'cloudSync', route: 'account', accountTab: 'sync', element: '[data-tour="account-sync"]', fallbackElement: account },
  { id: 'cloudSecurity', route: 'account', accountTab: 'security', element: '[data-tour="account-security"]', fallbackElement: account },
  { id: 'remoteDevices', route: 'account', accountTab: 'devices', element: '[data-tour="account-devices"]', fallbackElement: account },
  { id: 'remotePermissions', route: 'account', accountTab: 'devices', element: '[data-tour="remote-permissions"]', fallbackElement: account },
  { id: 'notifications', route: 'workbench', element: '[data-tour="notification-entry"]', side: 'bottom', align: 'end' },
]

export const productTourFeatureSteps = featureSteps.map((step) => ({ ...step, disableActiveInteraction: true }))
