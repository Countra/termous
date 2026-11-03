import type { Definition, Step, WorkflowExchangeDefinition, WorkflowExchangeStep } from '#entities/desktop-workflow'

export function workflowSummary(definition?: Definition | WorkflowExchangeDefinition) {
  const all: (Step | WorkflowExchangeStep)[] = []
  const walk = (values: (Step | WorkflowExchangeStep)[]) => { for (const step of values) { all.push(step); walk(step.steps ?? []); walk(step.else ?? []) } }
  walk(definition?.steps ?? [])
  const assets = new Set(all.flatMap(step => [step.image, step.target?.image, step.end_target?.image]
    .map(image => image && ('path' in image ? image.path : image.asset_id)).filter(Boolean)))
  return {
    count: all.length, disabled: all.filter(step => step.disabled).length,
    hasAssets: assets.size > 0, assetCount: assets.size,
    ocr: all.some(step => step.kind.startsWith('ocr.') || step.target?.kind === 'ocr' || step.end_target?.kind === 'ocr'),
  }
}
