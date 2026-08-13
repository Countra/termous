import type { AppConfig, DataPortabilityApplyResult, DataPortabilityPlanItemPage, DataPortabilityPlanItemQuery, DataPortabilityPlanRequest, DataPortabilityResolutionRequest, DataPortabilityRestorePlan, DataPortabilitySummary } from '#common/contracts';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

export class DataPortabilityClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

dataPortabilitySummary() {
    return this.request<DataPortabilitySummary>('/api/v1/data-portability/summary', { timeoutMs: 30_000 })
      .then(normalizeDataPortabilitySummary)
  }

createDataPortabilityPlan(importId: string, body: DataPortabilityPlanRequest) {
    return this.request<DataPortabilityRestorePlan>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans`,
      { method: 'POST', body, timeoutMs: 60_000 },
    ).then(normalizeDataPortabilityPlan)
  }

dataPortabilityPlanItems(importId: string, planId: string, query: DataPortabilityPlanItemQuery = {}) {
    const params = new URLSearchParams()
    if (query.dataset) params.set('dataset', query.dataset)
    if (query.status) params.set('status', query.status)
    if (query.cursor) params.set('cursor', query.cursor)
    if (query.limit) params.set('limit', String(query.limit))
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<DataPortabilityPlanItemPage>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans/${encodeURIComponent(planId)}/items${suffix}`,
      { timeoutMs: 30_000 },
    ).then(normalizeDataPortabilityPlanItemPage)
  }

resolveDataPortabilityPlan(importId: string, planId: string, body: DataPortabilityResolutionRequest) {
    return this.request<DataPortabilityRestorePlan>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans/${encodeURIComponent(planId)}/resolutions`,
      { method: 'PATCH', body, timeoutMs: 30_000 },
    ).then(normalizeDataPortabilityPlan)
  }

applyDataPortabilityPlan(importId: string, planId: string) {
    return this.request<DataPortabilityApplyResult>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans/${encodeURIComponent(planId)}/apply`,
      { method: 'POST', body: {}, timeoutMs: 120_000 },
    )
  }

cancelDataPortabilityImport(importId: string) {
    return this.request<void>(`/api/v1/data-portability/imports/${encodeURIComponent(importId)}`, {
      method: 'DELETE',
      timeoutMs: 30_000,
    })
  }
}

function normalizeDataPortabilitySummary(summary: DataPortabilitySummary): DataPortabilitySummary {
  return {
    ...summary,
    datasets: normalizeArray(summary.datasets),
  }
}

function normalizeDataPortabilityPlan(plan: DataPortabilityRestorePlan): DataPortabilityRestorePlan {
  return {
    ...plan,
    items: normalizeArray(plan.items),
    summary: {
      ...plan.summary,
      by_status: plan.summary?.by_status ?? {},
      by_dataset: plan.summary?.by_dataset ?? {},
    },
  }
}

function normalizeDataPortabilityPlanItemPage(page: DataPortabilityPlanItemPage): DataPortabilityPlanItemPage {
  return {
    ...page,
    items: normalizeArray(page.items),
  }
}
