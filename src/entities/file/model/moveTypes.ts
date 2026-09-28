export interface FileMoveResult {
  non_atomic: boolean
  partial: boolean
  uncertain: boolean
  items: Array<{
    source_path: string
    target_path: string
    status: 'pending' | 'copied' | 'moved' | 'skipped' | 'failed' | 'uncertain'
    copied?: boolean
    removed?: boolean
    target_changed?: boolean
    message?: string
  }>
}
