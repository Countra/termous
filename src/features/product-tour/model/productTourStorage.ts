import { PRODUCT_TOUR_VERSION } from './productTourSteps.ts'

export const PRODUCT_TOUR_STORAGE_KEY = 'termous.ui.productTour.completedVersion'

export interface ProductTourCompletionStore {
  readCompletedVersion: () => number | null
  writeCompletedVersion: (version: number) => boolean
}

type StorageProvider = () => Pick<Storage, 'getItem' | 'setItem'>

export function createProductTourCompletionStore(
  storageProvider: StorageProvider = () => window.localStorage,
): ProductTourCompletionStore {
  return {
    readCompletedVersion: () => {
      try {
        return parseCompletedVersion(storageProvider().getItem(PRODUCT_TOUR_STORAGE_KEY))
      } catch {
        return null
      }
    },
    writeCompletedVersion: (version) => {
      try {
        storageProvider().setItem(PRODUCT_TOUR_STORAGE_KEY, String(version))
        return true
      } catch {
        return false
      }
    },
  }
}

export function parseCompletedVersion(value: string | null): number | null {
  const normalized = value?.trim() ?? ''
  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    return null
  }
  const version = Number(normalized)
  return Number.isSafeInteger(version) && version >= 0 ? version : null
}

export function hasCompletedCurrentProductTour(store: ProductTourCompletionStore) {
  const completedVersion = store.readCompletedVersion()
  return completedVersion !== null && completedVersion >= PRODUCT_TOUR_VERSION
}

export const browserProductTourCompletionStore = createProductTourCompletionStore()
