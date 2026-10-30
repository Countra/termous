import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { FileReview, FileReviewLoader } from '#shared/file-review'
import { PagedFileReview } from './PagedFileReview.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const review: FileReview = { version: 1, id: 'r1', digest: 'a'.repeat(64), before_sha256: 'b'.repeat(64), after_sha256: 'c'.repeat(64), change_count: 2, coarse: false }

it('按页读取、切换版本视图并取消过期请求，不累计整文件正文', async () => {
  const signals: AbortSignal[] = []
  const load = vi.fn<FileReviewLoader>(async (query, signal) => {
    signals.push(signal)
    return { review, mode: query.mode, rows: [{ kind: 'add', text: query.cursor ? 'page-two\n' : `${query.mode}-one\n`, after_line: 1 }], cursor: query.cursor ? undefined : 'next' }
  })
  const view = render(<PagedFileReview review={review} load={load} />)
  expect(await screen.findByText('diff-one')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'fileReview.nextPage' }))
  expect(await screen.findByText('page-two')).toBeVisible()
  expect(screen.queryByText('diff-one')).not.toBeInTheDocument()
  expect(signals[0].aborted).toBe(true)
  fireEvent.click(screen.getByText('fileReview.before'))
  expect(await screen.findByText('before-one')).toBeVisible()
  expect(load.mock.calls[2][0].cursor).toBeUndefined()
  view.unmount()
  expect(signals.every(signal => signal.aborted)).toBe(true)
})

it('读取失败或版本不符明确提示，不降级为空白 Diff，重试可恢复', async () => {
  const load = vi.fn<FileReviewLoader>().mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ review: { ...review, digest: 'd'.repeat(64) }, mode: 'diff', rows: [] })
    .mockResolvedValue({ review, mode: 'diff', rows: [{ kind: 'remove', text: 'visible\n', before_line: 2 }] })
  render(<PagedFileReview review={review} load={load} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('fileReview.loadFailed')
  expect(screen.queryByText('fileReview.empty')).toBeNull()
  fireEvent.click(screen.getByText('app.retry'))
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('alert')).toBeVisible()
  fireEvent.click(screen.getByText('app.retry'))
  expect(await screen.findByText('visible')).toBeVisible()
})

it('长行明确分段，未修改上下文按需展开，历史不虚构完整源文件', async () => {
  const load = vi.fn<FileReviewLoader>(async query => ({ review, mode: query.mode,
    rows: [{ kind: 'add', text: '<script>text</script>', partial: true, after_line: 9 }, { kind: 'omitted', text: '' }] }))
  const view = render(<PagedFileReview review={review} load={load} />)
  expect(await screen.findByTitle('fileReview.partialLine')).toBeVisible()
  expect(view.container.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByText('fileReview.expandContext'))
  await waitFor(() => expect(load.mock.calls[1][0].context).toBe('all'))
  view.unmount()
  render(<PagedFileReview review={review} load={load} history />)
  expect(await screen.findByText('fileReview.historyContext')).toBeVisible()
  expect(screen.queryByText('fileReview.before')).toBeNull()
})

it('缺少末行换行和分段内容明确区分，切换模式立即清除旧内容', async () => {
  const load = vi.fn<FileReviewLoader>(async query => {
    if (query.mode === 'before') return new Promise(() => {})
    return { review, mode: query.mode, rows: [{ kind: 'remove', text: 'no-newline', before_line: 1 }, { kind: 'add', text: 'continued', partial: true, after_line: 1 }] }
  })
  render(<PagedFileReview review={review} load={load} />)
  expect(await screen.findByTitle('fileReview.noNewline')).toBeVisible()
  expect(screen.getByTitle('fileReview.partialLine')).toBeVisible()
  fireEvent.click(screen.getByText('fileReview.before'))
  expect(screen.queryByText('no-newline')).toBeNull()
  expect(screen.queryByText('continued')).toBeNull()
  expect(screen.getByRole('region', { name: 'fileReview.content' })).toHaveAttribute('aria-busy', 'true')
})
