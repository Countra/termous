import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FileTextReview } from './FileTextReview'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: Record<string, unknown>) => args ? `${key}:${JSON.stringify(args)}` : key }) }))

it('默认差异能切换到完整原文，空文件和字面 HTML 不丢失或执行', () => {
  const view = render(<FileTextReview before={'same\nold\n'} after={'same\n<script>new</script>\n'} />)
  expect(screen.getByText('old')).toBeInTheDocument()
  expect(screen.getByText('<script>new</script>')).toBeInTheDocument()
  expect(view.container.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByText('fileReview.before'))
  expect(screen.queryByText('<script>new</script>')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'fileReview.wrap' }))
  expect(screen.getByRole('button', { name: 'fileReview.wrap' })).toHaveAttribute('aria-pressed', 'true')
})

it('完整上下文按页渲染，截断片段不标成文件末尾', () => {
  const view = render(<FileTextReview after={Array.from({ length: 1000 }, (_, i) => `text-${i}\n`).join('') + 'partial'} incomplete />)
  expect(view.container.querySelectorAll('code')).toHaveLength(100)
  expect(screen.queryByTitle('fileReview.noNewline')).not.toBeInTheDocument()
  fireEvent.click(screen.getByTitle('Next Page'))
  expect(screen.queryByText('text-0')).not.toBeInTheDocument()
  expect(screen.getByText('text-100')).toBeInTheDocument()
  expect(view.container.querySelectorAll('code')).toHaveLength(100)
  view.rerender(<FileTextReview after="" />)
  expect(screen.getByText('fileReview.empty')).toBeInTheDocument()
})
