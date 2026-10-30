export interface FileReview {
  version: 1
  id: string
  digest: string
  before_sha256: string
  after_sha256: string
  change_count: number
  coarse: boolean
}
export type FileReviewMode = 'diff' | 'before' | 'after'
export interface FileReviewRow {
  kind: 'equal' | 'add' | 'remove' | 'omitted'
  text: string
  before_line?: number
  after_line?: number
  partial?: boolean
}
export interface FileReviewPage { review: FileReview; mode: FileReviewMode; rows: FileReviewRow[]; cursor?: string }
export interface FileReviewQuery { digest: string; mode: FileReviewMode; cursor?: string; context?: 'all' }
export type FileReviewLoader = (query: FileReviewQuery, signal: AbortSignal) => Promise<FileReviewPage>
export type FileHistoryLoader = (reviewId: string, digest: string, cursor?: string) => Promise<FileReviewPage>
