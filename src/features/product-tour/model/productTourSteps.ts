import type { Alignment, Side } from 'driver.js'

export const PRODUCT_TOUR_VERSION = 2

export type ProductTourStepId =
  | 'welcome'
  | 'vaultNav'
  | 'vaultActions'
  | 'credentialEditor'
  | 'hostsNav'
  | 'hostEditor'
  | 'hostConnections'
  | 'topbarConnect'
  | 'workbench'
  | 'workbenchTools'
  | 'files'
  | 'forwards'
  | 'snippets'
  | 'settings'
  | 'finish'

type ProductTourRoute =
  | 'vault'
  | 'hosts'
  | 'workbench'
  | 'files'
  | 'forwards'
  | 'snippets'
  | 'settings'

type ProductTourPreparation =
  | 'vaultCatalog'
  | 'credentialEditor'
  | 'hostCatalog'
  | 'hostEditor'
  | 'hostConnections'

export interface ProductTourStep {
  id: ProductTourStepId
  title: string
  description: string
  element?: string
  route?: ProductTourRoute
  preparation?: ProductTourPreparation
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

type ProductTourTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string

interface ProductTourStepBlueprint {
  id: ProductTourStepId
  element?: string
  route?: ProductTourRoute
  preparation?: ProductTourPreparation
  side?: Side
  align?: Alignment
}

const stepBlueprints: ProductTourStepBlueprint[] = [
  { id: 'welcome' },
  {
    id: 'vaultNav',
    element: '[data-tour="nav-vault"]',
    route: 'vault',
    side: 'right',
    align: 'center',
  },
  {
    id: 'vaultActions',
    element: '[data-active-view="catalog"] [data-tour="vault-actions"]',
    route: 'vault',
    preparation: 'vaultCatalog',
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'credentialEditor',
    element: '[data-active-view="editor"] [data-tour="credential-editor"]',
    route: 'vault',
    preparation: 'credentialEditor',
    side: 'left',
    align: 'start',
  },
  {
    id: 'hostsNav',
    element: '[data-active-view="catalog"] [data-tour="hosts-add"]',
    route: 'hosts',
    preparation: 'hostCatalog',
    side: 'right',
    align: 'end',
  },
  {
    id: 'hostEditor',
    element: '[data-active-view="editor"] [data-tour="host-editor"]',
    route: 'hosts',
    preparation: 'hostEditor',
    side: 'left',
    align: 'start',
  },
  {
    id: 'hostConnections',
    element: '[data-active-view="editor"] [data-tour="host-editor"] [data-tour="host-connection-catalog"]',
    route: 'hosts',
    preparation: 'hostConnections',
    side: 'left',
    align: 'start',
  },
  {
    id: 'topbarConnect',
    element: '[data-tour="topbar-connect"]',
    route: 'workbench',
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'workbench',
    element: '[data-tour="workbench-terminal"]',
    route: 'workbench',
    side: 'top',
    align: 'center',
  },
  {
    id: 'workbenchTools',
    element: '[data-tour="workbench-tools"]',
    route: 'workbench',
    side: 'left',
    align: 'center',
  },
  {
    id: 'files',
    element: '[data-tour="files-workspace"]',
    route: 'files',
    side: 'top',
    align: 'center',
  },
  {
    id: 'forwards',
    element: '[data-tour="forwards-overview"]',
    route: 'forwards',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'snippets',
    element: '[data-tour="snippets-workspace"]',
    route: 'snippets',
    side: 'right',
    align: 'center',
  },
  {
    id: 'settings',
    element: '[data-tour="settings-workspace"]',
    route: 'settings',
    side: 'top',
    align: 'center',
  },
  {
    id: 'finish',
    element: '[data-tour="product-tour-trigger"]',
    route: 'settings',
    side: 'right',
    align: 'end',
  },
]

export function buildProductTourSteps(t: ProductTourTranslate): ProductTourStep[] {
  return stepBlueprints.map((step) => ({
    ...step,
    title: t(`productTour.steps.${step.id}.title`),
    description: t(`productTour.steps.${step.id}.description`),
  }))
}

export function buildProductTourLabels(t: ProductTourTranslate): ProductTourLabels {
  return {
    progress: t('productTour.progress', {
      current: '{{current}}',
      total: '{{total}}',
      interpolation: { escapeValue: false },
    }),
    next: t('productTour.next'),
    previous: t('productTour.previous'),
    done: t('productTour.done'),
    skip: t('productTour.skip'),
    close: t('productTour.close'),
  }
}
