import type { Region } from '#entities/desktop-workflow'
import { sameSelection } from './selection.ts'

type Selection = Region | undefined
export interface SelectionHistory {
  past: Selection[]
  present: Selection
  future: Selection[]
  preview?: { value: Selection }
}
type Action = { type: 'preview' | 'commit' | 'reset'; value?: Region } | { type: 'cancel' | 'undo' | 'redo' }

export function initialSelectionHistory(value?: Region): SelectionHistory {
  return { past: [], present: value, future: [] }
}

export function selectionHistory(state: SelectionHistory, action: Action): SelectionHistory {
  switch (action.type) {
    case 'preview': return { ...state, preview: { value: action.value } }
    case 'cancel': return state.preview ? { ...state, preview: undefined } : state
    case 'reset': return initialSelectionHistory(action.value)
    case 'commit':
      if (sameSelection(state.present, action.value)) return state.preview ? { ...state, preview: undefined } : state
      // 每个完成的手势只保存一条原图坐标记录；限制长度，避免长期编辑持续累积。
      return { past: [...state.past.slice(-99), state.present], present: action.value, future: [] }
    case 'undo':
      return state.past.length ? {
        past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future],
      } : state
    case 'redo':
      return state.future.length ? {
        past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1),
      } : state
  }
}
