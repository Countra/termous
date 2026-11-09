import type { OCRParameters, OCRQuery, Step } from '#entities/desktop-workflow'
import type { ImageSlot } from './images'
export const newOCRQuery = (defaults: OCRParameters): OCRQuery => ({ ...defaults, text: '', match: 'exact', case_sensitive: true, normalize_whitespace: true })

export function stepOCR(step: Step, slot: ImageSlot): OCRQuery | undefined {
  if (slot === 'image') return step.ocr
  const target = step[slot]
  if (target?.kind !== 'ocr' || !target.ocr) return undefined
  const {text,match,case_sensitive,normalize_whitespace,text_confidence,ocr_max_side,region,reference_width,reference_height} = target.ocr
  return {text,match,case_sensitive,normalize_whitespace,text_confidence,ocr_max_side,region,reference_width,reference_height}
}
export function setStepOCR(step: Step, slot: ImageSlot, query: OCRQuery): Step {
  if (slot === 'image') return {...step,ocr:query,image:undefined}
  const target = step[slot]
  return {...step,[slot]:{kind:'ocr',ocr:{...target?.ocr,...query,offset:target?.ocr?.offset ?? {x:0,y:0}}}}
}
export function bindOCRText(step: Step, field: string): Step {
  if (field === 'ocr_text' && step.ocr) return {...step,ocr:{...step.ocr,text:undefined}}
  const slot = field === 'target_ocr_text' ? 'target' : field === 'end_target_ocr_text' ? 'end_target' : undefined
  return slot && step[slot]?.ocr ? setStepOCR(step,slot,{...step[slot]!.ocr!,text:undefined}) : step
}
