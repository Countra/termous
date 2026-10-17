import { Camera, Clipboard, Clock3, GitBranch, Hand, Keyboard, Maximize, MousePointer2, MousePointerClick, Move, Pause, Repeat2, ScanSearch, ScanLine, ScrollText, TextCursorInput } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { Step, StepKind } from '#entities/desktop-workflow'

export const stepIcons = {
  'pointer.click': MousePointerClick, 'pointer.move': MousePointer2,
  'pointer.scroll': ScrollText, 'pointer.drag': Move,
  'keyboard.key': Keyboard, 'keyboard.shortcut': Hand, 'keyboard.text': TextCursorInput,
  'clipboard.set_text': Clipboard, resize: Maximize, capture: Camera, delay: Clock3,
  'image.wait': ScanSearch, 'image.assert': ScanLine, if: GitBranch, repeat: Repeat2, breakpoint: Pause,
} satisfies Record<StepKind, typeof MousePointer2>

export const stepGroups: { key: string; kinds: StepKind[] }[] = [
  { key: 'pointer', kinds: ['pointer.click', 'pointer.move', 'pointer.scroll', 'pointer.drag'] },
  { key: 'keyboard', kinds: ['keyboard.key', 'keyboard.shortcut', 'keyboard.text', 'clipboard.set_text'] },
  { key: 'image', kinds: ['image.wait', 'image.assert', 'capture', 'resize'] },
  { key: 'flow', kinds: ['delay', 'if', 'repeat', 'breakpoint'] },
]

export const stepLabel = (kind: StepKind, t: TFunction) => t(`desktopWorkflow.kinds.${kind.replace(/\./g, '_')}`, { defaultValue: kind })

export function stepSummary(step: Step, t: TFunction): string {
  if (step.disabled) return t('desktopWorkflow.disabledStep')
  if (Object.keys(step.bindings ?? {}).length) return t('desktopWorkflow.parameterizedStep')
  if (step.kind === 'delay') return `${step.delay_ms ?? 0} ms`
  if (step.kind === 'repeat') return t('desktopWorkflow.repeatCount', { count: step.iterations ?? 2 })
  if (step.kind.startsWith('pointer.') && step.target?.kind === 'point') return `${step.target.x ?? 0}, ${step.target.y ?? 0} · ${t('desktopWorkflow.pointTarget')}`
  return stepLabel(step.kind, t)
}
