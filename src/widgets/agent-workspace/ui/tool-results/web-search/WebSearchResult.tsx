import { useTranslation } from 'react-i18next'
import type { WebSearchResult as Result } from '#common/contracts'

export function WebSearchResult({ result }: { result: Result }) {
  const { t } = useTranslation()
  return <section aria-label={t('webSearch.results')}>
    <p>{t('webSearch.resultInfo', { provider: result.provider, page: result.page })} · <time dateTime={result.retrieved_at}>{new Date(result.retrieved_at).toLocaleString()}</time></p>
    <p>{t('webSearch.snippetsOnly')}</p>
    {result.partial && <p role="status">{t('webSearch.partial')}</p>}
    {result.truncated && <p>{t('webSearch.truncated')}</p>}
    {result.results.length === 0 && !result.partial && !result.truncated && <p>{t('webSearch.empty')}</p>}
    <ol>{result.results.map(item => <li key={item.url}>
      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || item.url}</a>
      <p>{item.snippet}</p>
      {item.published_at && <time dateTime={item.published_at}>{new Date(item.published_at).toLocaleDateString()}</time>}
    </li>)}</ol>
    {result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
  </section>
}
