import type { ImageTarget, Step, Target } from '#entities/desktop-workflow'

export type ImageSlot = 'target' | 'end_target' | 'image'
export function stepImage(step: Step, slot: ImageSlot) { return slot === 'image' ? step.image : step[slot]?.image }
export function setStepImage(step: Step, slot: ImageSlot, image: ImageTarget): Step {
  return slot === 'image' ? { ...step, image } : setStepTarget(step, slot, { kind: 'image', image })
}
export function setStepTarget(step: Step, slot: 'target' | 'end_target', target: Target): Step {
  const bindings = { ...step.bindings }
  if (slot === 'target' && target.kind !== 'point') { delete bindings.x; delete bindings.y }
  return { ...step, [slot]: target, bindings }
}
export const blankImage = (): ImageTarget => ({ asset_id: '', threshold: .95, scales: [1], offset: { x: 0, y: 0 } })
