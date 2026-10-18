import type { Alignment, Side } from 'driver.js'

export type ProductTourStepId =
  | 'welcome'
  | 'vaultNav'
  | 'vaultActions'
  | 'credentialEditor'
  | 'hostsNav'
  | 'hostEditor'
  | 'hostConnections'
  | 'fileProfiles'
  | 'topbarConnect'
  | 'workbench'
  | 'workbenchTools'
  | 'files'
  | 'filesBookmarks'
  | 'filesLocalDirectory'
  | 'filesTransfers'
  | 'mounts'
  | 'mountsRuntime'
  | 'forwards'
  | 'snippets'
  | 'audit'
  | 'settings'
  | 'settingsTerminal'
  | 'settingsMount'
  | 'settingsMcp'
  | 'settingsSkills'
  | 'settingsAgent'
  | 'settingsData'
  | 'finish'
  | 'desktop' | 'desktopConnect' | 'desktopTools' | 'desktopFiles'
  | 'automationEntry' | 'automationLibrary' | 'automationEditor' | 'automationPreview' | 'automationHistory' | 'automationWindow'
  | 'settingsModels' | 'agent' | 'agentContext' | 'agentApproval' | 'agentWindow'
  | 'account' | 'cloudSync' | 'cloudSecurity' | 'remoteDevices' | 'remotePermissions' | 'notifications'

type ProductTourRoute =
  | 'vault'
  | 'hosts'
  | 'workbench'
  | 'files'
  | 'mounts'
  | 'forwards'
  | 'snippets'
  | 'audit'
  | 'settings'
  | 'remote-desktop'
  | 'agent'
  | 'account'

type ProductTourPreparation =
  | 'vaultCatalog'
  | 'credentialEditor'
  | 'hostCatalog'
  | 'hostEditor'
  | 'hostConnections'
  | 'settingsTerminal'
  | 'settingsMount'
  | 'settingsMcp'
  | 'settingsAgent'
  | 'settingsData'
  | 'settingsModels'

export interface ProductTourStep {
  id: ProductTourStepId
  title: string
  description: string
  element?: string
  fallbackElement?: string
  route?: ProductTourRoute
  desktopView?: 'desktops' | 'workflow'
  accountTab?: 'sync' | 'devices' | 'security'
  preparation?: ProductTourPreparation
  disableActiveInteraction?: boolean
  side?: Side
  align?: Alignment
}

export interface ProductTourLabels {
  progress: string
  next: string
  previous: string
  done: string
  skip: string
  close: string
}

export type ProductTourTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string

export type ProductTourStepBlueprint = Omit<ProductTourStep, 'title' | 'description'>
