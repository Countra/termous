import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
import { i18n } from '#shared/i18n'
import { WebSearchResult } from './WebSearchResult'

it('搜索摘要转义展示，不加载图片，并说明部分结果与截断', async () => {
  await i18n.changeLanguage('zh-CN')
  const { container } = render(<I18nextProvider i18n={i18n}><WebSearchResult result={{ provider: 'searxng', query: 'test', page: 2, retrieved_at: '2026-10-31T00:00:00Z', partial: true, truncated: true, warnings: [],
    results: [{ title: '<img src="https://example.test/tracker">', url: 'https://example.test', snippet: '<script>bad()</script>' }] }} /></I18nextProvider>)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.getByText('<script>bad()</script>')).toBeVisible()
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByRole('status')).toHaveTextContent('未完整完成')
  expect(screen.getByText(/结果已按请求数量/u)).toBeVisible()
})

it('不完整或被截断的空回执不能显示为没有匹配结果', async () => {
  await i18n.changeLanguage('zh-CN')
  const result = { provider: 'searxng' as const, query: 'test', page: 1, retrieved_at: '2026-10-31T00:00:00Z', partial: true, truncated: false, warnings: [], results: [] }
  const view = (partial: boolean, truncated: boolean) => <I18nextProvider i18n={i18n}><WebSearchResult result={{ ...result, partial, truncated }} /></I18nextProvider>
  const { rerender } = render(view(true, false))
  expect(screen.queryByText('搜索正常完成，没有匹配结果。')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toBeVisible()
  rerender(view(false, true))
  expect(screen.queryByText('搜索正常完成，没有匹配结果。')).not.toBeInTheDocument()
  rerender(view(false, false))
  expect(screen.getByText('搜索正常完成，没有匹配结果。')).toBeVisible()
})
