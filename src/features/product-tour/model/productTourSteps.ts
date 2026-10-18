import type { ProductTourStep, ProductTourLabels, ProductTourTranslate, ProductTourStepBlueprint } from './productTourTypes.ts'
export type { ProductTourStep, ProductTourStepId, ProductTourLabels } from './productTourTypes.ts'
import { productTourFeatureSteps } from './productTourFeatureSteps.ts'
import { getProductTourTopic, type ProductTourTopicId } from './productTourTopics.ts'

export const PRODUCT_TOUR_VERSION = 5

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
    id: 'fileProfiles',
    element: '[data-active-view="editor"] [data-tour="host-editor"] [data-tour="host-connection-catalog"]',
    route: 'hosts',
    preparation: 'hostConnections',
    disableActiveInteraction: true,
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
    id: 'filesBookmarks',
    element: '[data-tour="files-bookmarks"]',
    route: 'files',
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'filesLocalDirectory',
    element: '[data-tour="files-local-directory"]',
    route: 'files',
    side: 'top',
    align: 'start',
  },
  {
    id: 'filesTransfers',
    element: '[data-tour="files-transfers"]',
    route: 'files',
    side: 'top',
    align: 'end',
  },
  {
    id: 'mounts',
    element: '[data-tour="mounts-overview"]',
    route: 'mounts',
    disableActiveInteraction: true,
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'mountsRuntime',
    element: '[data-tour="mounts-runtime"]',
    route: 'mounts',
    disableActiveInteraction: true,
    side: 'left',
    align: 'start',
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
    id: 'audit',
    element: '[data-tour="audit-workspace"]',
    route: 'audit',
    disableActiveInteraction: true,
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'settings',
    element: '[data-tour="settings-workspace"]',
    route: 'settings',
    side: 'top',
    align: 'center',
  },
  {
    id: 'settingsTerminal',
    element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-terminal"]',
    route: 'settings',
    preparation: 'settingsTerminal',
    // 设置步骤仅作讲解，避免向导返回其他页面时丢失临时编辑或取消导入。
    disableActiveInteraction: true,
    side: 'top',
    align: 'start',
  },
  {
    id: 'settingsMount',
    element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-mount"]',
    route: 'settings',
    preparation: 'settingsMount',
    disableActiveInteraction: true,
    side: 'top',
    align: 'start',
  },
  {
    id: 'settingsMcp',
    element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-mcp"]',
    route: 'settings',
    preparation: 'settingsMcp',
    disableActiveInteraction: true,
    side: 'top',
    align: 'start',
  },
  {
    id: 'settingsSkills',
    element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-skills-install"]',
    route: 'settings',
    preparation: 'settingsMcp',
    disableActiveInteraction: true,
    side: 'left',
    align: 'center',
  },
  {
    id: 'settingsAgent',
    element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-agent"]',
    route: 'settings',
    preparation: 'settingsAgent',
    disableActiveInteraction: true,
    side: 'top',
    align: 'start',
  },
  {
    id: 'settingsData',
    element: '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-data"]',
    route: 'settings',
    preparation: 'settingsData',
    disableActiveInteraction: true,
    side: 'top',
    align: 'start',
  },
  {
    id: 'finish',
  },
]

export function buildProductTourSteps(t: ProductTourTranslate, topic?: ProductTourTopicId): ProductTourStep[] {
  const catalog = [...stepBlueprints.slice(0, -1), ...productTourFeatureSteps, stepBlueprints[stepBlueprints.length - 1]]
  const blueprints = topic
    ? getProductTourTopic(topic).steps.map((id) => catalog.find((step) => step.id === id)!)
    : catalog
  return blueprints.map((step) => ({
    ...step,
    // 专题引导只讲解；编辑、连接与授权交由用户退出向导后主动进行。
    ...(topic ? { disableActiveInteraction: true } : {}),
    title: t(`productTour.steps.${step.id}.title`),
    description: t(`productTour.steps.${step.id}.description`),
  }))
}

export function buildProductTourLabels(t: ProductTourTranslate, topic?: ProductTourTopicId): ProductTourLabels {
  return {
    progress: t('productTour.progress', {
      current: '{{current}}',
      total: '{{total}}',
      interpolation: { escapeValue: false },
    }),
    next: t('productTour.next'),
    previous: t('productTour.previous'),
    done: t(topic ? 'productTour.finishTopic' : 'productTour.done'),
    skip: t(topic ? 'productTour.backToTopics' : 'productTour.skip'),
    close: t('productTour.close'),
  }
}
