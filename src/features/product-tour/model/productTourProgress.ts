import { createProductTourCompletionStore } from './productTourStorage.ts'
import { productTourTopics, type ProductTourTopicId } from './productTourTopics.ts'

type TourStorage = Pick<Storage, 'getItem' | 'setItem'>
const SEEN_KEY = 'termous.ui.productTour.basics.seen'

export function createProductTourProgress(storage: () => TourStorage = () => window.localStorage) {
  const legacy = createProductTourCompletionStore(storage)
  const stores = new Map(productTourTopics.map(({ id }) => [id,
    createProductTourCompletionStore(storage, `termous.ui.productTour.topic.${id}`),
  ]))
  let seenInSession = false
  return {
    forTopic: (id: ProductTourTopicId) => stores.get(id)!,
    shouldOfferBasics: () => {
      if (seenInSession || legacy.readCompletedVersion() !== null || stores.get('basics')!.readCompletedVersion() !== null) return false
      try { return storage().getItem(SEEN_KEY) !== '1' }
      catch { return true }
    },
    markBasicsSeen: () => {
      // 存储不可用时仍避免在本次应用会话中反复自动弹出。
      seenInSession = true
      try { storage().setItem(SEEN_KEY, '1') }
      catch { /* 仅影响下次启动是否自动展示，不影响向导使用。 */ }
    },
  }
}

export type ProductTourProgress = ReturnType<typeof createProductTourProgress>
export const browserProductTourProgress = createProductTourProgress()
