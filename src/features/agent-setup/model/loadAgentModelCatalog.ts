import type {
  AgentModel,
  AgentModelListQuery,
  AgentModelPage,
  AgentModelProvider,
  AgentModelProviderPage,
} from '#entities/agent'
import { TermousApiError } from '#shared/api'

const maximumProviders = 32
const maximumModels = 32_000
const maximumModelPages = 400
const maximumSnapshotAttempts = 2

export interface AgentModelCatalogSource {
  modelProviders(cursor?: string, signal?: AbortSignal): Promise<AgentModelProviderPage>
  models(query?: AgentModelListQuery, cursor?: string, signal?: AbortSignal): Promise<AgentModelPage>
}

export interface AgentModelCatalog {
  providers: AgentModelProvider[]
  models: AgentModel[]
}

export async function loadAgentModelCatalog(
  source: AgentModelCatalogSource,
  signal?: AbortSignal,
): Promise<AgentModelCatalog> {
  let lastFailure: CatalogSnapshotFailure = 'changed'
  for (let attempt = 0; attempt < maximumSnapshotAttempts; attempt += 1) {
    let snapshot: Awaited<ReturnType<typeof loadCatalogSnapshot>>
    try {
      snapshot = await loadCatalogSnapshot(source, signal)
    } catch (error) {
      if (!isCatalogRevisionConflict(error) || attempt === maximumSnapshotAttempts - 1) throw error
      signal?.throwIfAborted()
      continue
    }
    if (!snapshot.failure) return snapshot.catalog
    lastFailure = snapshot.failure
    signal?.throwIfAborted()
  }
  throw new Error(lastFailure === 'unknown_provider'
    ? 'Agent 模型目录包含未知 Provider'
    : 'Agent 模型目录在读取期间持续变化')
}

function isCatalogRevisionConflict(error: unknown) {
  return error instanceof TermousApiError
    && error.status === 409
    && error.code === 'AGENT_REVISION_CONFLICT'
}

type CatalogSnapshotFailure = 'changed' | 'unknown_provider'

async function loadCatalogSnapshot(
  source: AgentModelCatalogSource,
  signal?: AbortSignal,
): Promise<{ catalog: AgentModelCatalog; failure?: CatalogSnapshotFailure }> {
  const [providers, modelCollection] = await Promise.all([
    loadAllAgentModelProviders(source, signal),
    collectAllAgentModels(source, signal),
  ])
  const catalog = { providers, models: modelCollection.items }
  if (modelCollection.paginated) {
    signal?.throwIfAborted()
    const [providersAfter, firstModelPageAfter] = await Promise.all([
      loadAllAgentModelProviders(source, signal),
      source.models({ state: 'all' }, undefined, signal),
    ])
    if (!sameRevisionSequence(providers, providersAfter)
      || !sameModelSnapshotSequence(modelCollection.firstPage, firstModelPageAfter.items)) {
      return { catalog, failure: 'changed' }
    }
  }
  if (hasUnknownProvider(catalog)) return { catalog, failure: 'unknown_provider' }
  return { catalog }
}

function hasUnknownProvider({ providers, models }: AgentModelCatalog) {
  const providerIds = new Set(providers.map(({ id }) => id))
  return models.some(({ provider_id }) => !providerIds.has(provider_id))
}

export async function loadAllAgentModelProviders(
  source: Pick<AgentModelCatalogSource, 'modelProviders'>,
  signal?: AbortSignal,
) {
  const providers: AgentModelProvider[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined

  while (providers.length < maximumProviders) {
    const page = await source.modelProviders(cursor, signal)
    appendUnique(page.items, providers, ids, maximumProviders, 'Agent Provider 分页无效')
    if (!page.next_cursor) return providers
    assertCursorProgress(page.next_cursor, cursor, page.items.length, cursors, 'Agent Provider 分页无效')
    cursors.add(page.next_cursor)
    cursor = page.next_cursor
  }
  throw new Error('Agent Provider 分页无效')
}

export async function loadAllAgentModels(
  source: Pick<AgentModelCatalogSource, 'models'>,
  signal?: AbortSignal,
) {
  return (await collectAllAgentModels(source, signal)).items
}

async function collectAllAgentModels(
  source: Pick<AgentModelCatalogSource, 'models'>,
  signal?: AbortSignal,
) {
  const models: AgentModel[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let firstPage: AgentModel[] = []
  let paginated = false
  let cursor: string | undefined

  for (let pageIndex = 0; pageIndex < maximumModelPages; pageIndex += 1) {
    const page = await source.models({ state: 'all' }, cursor, signal)
    if (pageIndex === 0) firstPage = page.items
    appendUnique(page.items, models, ids, maximumModels, 'Agent 模型分页无效')
    if (!page.next_cursor) return { items: models, firstPage, paginated }
    paginated = true
    assertCursorProgress(page.next_cursor, cursor, page.items.length, cursors, 'Agent 模型分页无效')
    cursors.add(page.next_cursor)
    cursor = page.next_cursor
  }
  throw new Error('Agent 模型分页无效')
}

function sameRevisionSequence(
  left: ReadonlyArray<{ id: string; revision: number }>,
  right: ReadonlyArray<{ id: string; revision: number }>,
) {
  return left.length === right.length
    && left.every((item, index) => item.id === right[index]?.id && item.revision === right[index]?.revision)
}

function sameModelSnapshotSequence(left: AgentModel[], right: AgentModel[]) {
  return left.length === right.length
    && left.every((item, index) => {
      const candidate = right[index]
      return item.id === candidate?.id
        && item.revision === candidate.revision
        && item.effective_context_window_tokens === candidate.effective_context_window_tokens
        && item.effective_max_output_tokens === candidate.effective_max_output_tokens
        && item.effective_default_reasoning_level === candidate.effective_default_reasoning_level
    })
}

function appendUnique<Item extends { id: string }>(
  next: Item[],
  target: Item[],
  ids: Set<string>,
  maximum: number,
  message: string,
) {
  for (const item of next) {
    if (ids.has(item.id) || target.length >= maximum) throw new Error(message)
    ids.add(item.id)
    target.push(item)
  }
}

function assertCursorProgress(
  nextCursor: string,
  currentCursor: string | undefined,
  itemCount: number,
  seen: Set<string>,
  message: string,
) {
  if (itemCount === 0 || nextCursor === currentCursor || seen.has(nextCursor)) throw new Error(message)
}
