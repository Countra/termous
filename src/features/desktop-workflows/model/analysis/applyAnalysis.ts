import type { AnalysisElement, AnalysisRecord } from '#common/contracts'
import type { Snapshot, Step } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../workspace/types'
import { analysisRegion } from '../analysis'
import { blankImage, setStepImage, setStepTarget, stepImage, type ImageSlot } from '../images'

export type AnalysisApplication = 'point' | 'template' | 'region'
export async function prepareAnalysisApplication(gateway: WorkflowMediaGateway, record: AnalysisRecord, preview: string, element: AnalysisElement,
  step: Step, slot: ImageSlot, kind: AnalysisApplication, validate: () => void): Promise<{ step: Step; snapshot: Snapshot }> {
  validate()
  await gateway.validateAnalysisAction(record.id, preview)
  validate()
  if (!record.metadata || !record.image) throw new Error('analysis_invalid_response')
  const blob = await gateway.analysisImage(record.id, 'original')
  validate()
  const meta = record.metadata
  const reference = { reference_width: meta.desktop_width, reference_height: meta.desktop_height }
  const snapshot = { blob, metadata: meta }
  let next: Step
  if (kind === 'point') {
    if (slot === 'image' || !step.kind.startsWith('pointer.')) throw new Error('analysis_conflict')
    next = setStepTarget(step, slot, { kind: 'point', x: element.center_xy[0], y: element.center_xy[1], ...reference })
  } else {
    const region = analysisRegion(element, meta.width, meta.height)
    const image = stepImage(step, slot) ?? blankImage()
    if (kind === 'region') next = setStepImage(step, slot, { ...image, region, ...reference })
    else {
      const bitmap = await createImageBitmap(blob)
      let cropped: Blob
      try {
        validate()
        const canvas = document.createElement('canvas'); canvas.width = region.width; canvas.height = region.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('analysis_crop_failed')
        context.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
        try { cropped = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('analysis_crop_failed')), 'image/png')) }
        finally { canvas.width = 0; canvas.height = 0 }
      } finally { bitmap.close() }
      validate()
      const asset = await gateway.upload(cropped)
      validate()
      next = setStepImage(step, slot, { ...image, asset_id: asset.id, anchor: undefined, template_source: { region, ...reference } })
    }
  }
  await gateway.validateAnalysisAction(record.id, preview)
  validate()
  return { step: next, snapshot }
}
