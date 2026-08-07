import type {
  DataPortabilityApplyResult,
  DataPortabilityPlanItemPage,
  DataPortabilityPlanItemQuery,
  DataPortabilityPlanRequest,
  DataPortabilityResolutionRequest,
  DataPortabilityRestorePlan,
  DataPortabilitySummary,
} from '#common/contracts'

export interface DataPortabilityGateway {
  dataPortabilitySummary(): Promise<DataPortabilitySummary>
  createDataPortabilityPlan(
    importId: string,
    body: DataPortabilityPlanRequest,
  ): Promise<DataPortabilityRestorePlan>
  dataPortabilityPlanItems(
    importId: string,
    planId: string,
    query?: DataPortabilityPlanItemQuery,
  ): Promise<DataPortabilityPlanItemPage>
  resolveDataPortabilityPlan(
    importId: string,
    planId: string,
    body: DataPortabilityResolutionRequest,
  ): Promise<DataPortabilityRestorePlan>
  applyDataPortabilityPlan(
    importId: string,
    planId: string,
  ): Promise<DataPortabilityApplyResult>
  cancelDataPortabilityImport(importId: string): Promise<void>
}
