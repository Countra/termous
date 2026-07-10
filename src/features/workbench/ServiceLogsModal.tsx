import { Button, Input, Modal, Segmented, Select, Tooltip } from 'antd'
import {
  ArrowDownToLine,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  FileClock,
  RefreshCw,
  Regex,
  Search,
  WrapText,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SystemServiceLogEntry, SystemServiceLogsResult } from '../../types/domain'
import type { SessionServiceLogQueryState } from './useSessionServices'
import './service-logs-modal.css'

interface ServiceLogsModalProps {
  open: boolean
  unitId: string
  logs: SystemServiceLogsResult | null
  loading: boolean
  error: string
  query: SessionServiceLogQueryState
  onQueryChange: (patch: Partial<SessionServiceLogQueryState>) => void
  onRefresh: (query: SessionServiceLogQueryState, append: boolean) => void
  onClose: () => void
}

interface LogMatchRange {
  start: number
  end: number
  index: number
}

interface LogSearchResult {
  matches: Array<{ lineIndex: number; matchIndex: number }>
  byLine: Record<number, LogMatchRange[]>
  invalidRegex: boolean
}

const priorityOptions = ['', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']
const limitOptions = [100, 200, 500, 1000]
const emptyLogEntries: SystemServiceLogEntry[] = []

export function ServiceLogsModal({
  open,
  unitId,
  logs,
  loading,
  error,
  query,
  onQueryChange,
  onRefresh,
  onClose,
}: ServiceLogsModalProps) {
  const { t } = useTranslation()
  const consoleRef = useRef<HTMLDivElement | null>(null)
  const [searchText, setSearchText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regexMode, setRegexMode] = useState(false)
  const [wrapLines, setWrapLines] = useState(false)
  const [activeMatch, setActiveMatch] = useState(0)
  const entries = logs?.entries ?? emptyLogEntries
  const search = useMemo(
    () => buildLogSearch(entries, searchText, caseSensitive, regexMode),
    [caseSensitive, entries, regexMode, searchText],
  )

  useEffect(() => {
    setActiveMatch((current) => search.matches.length > 0 ? Math.min(current, search.matches.length - 1) : 0)
  }, [search.matches.length])

  useEffect(() => {
    if (!open || search.matches.length === 0) {
      return
    }
    const match = search.matches[activeMatch]
    const target = consoleRef.current?.querySelector<HTMLElement>(`[data-service-log-line="${match.lineIndex}"]`)
    target?.scrollIntoView({ block: 'center' })
  }, [activeMatch, open, search.matches])

  const moveMatch = (direction: -1 | 1) => {
    if (search.matches.length === 0) {
      return
    }
    setActiveMatch((current) => (current + direction + search.matches.length) % search.matches.length)
  }

  const applyRemoteQuery = (patch: Partial<SessionServiceLogQueryState>) => {
    const next = { ...query, ...patch }
    onQueryChange(patch)
    onRefresh(next, false)
  }

  return (
    <Modal
      centered
      open={open}
      width="min(1120px, calc(100vw - 56px))"
      footer={null}
      title={null}
      closable={false}
      mask={{ closable: false }}
      className="service-logs-modal"
      rootClassName="service-logs-modal-root"
      onCancel={onClose}
    >
      <div className="service-logs-view">
        <header className="service-logs-header">
          <span className="service-logs-heading-icon"><FileClock size={18} /></span>
          <div className="service-logs-heading-copy">
            <strong>{t('workbench.services.logsViewerTitle')}</strong>
            <Tooltip title={unitId}><span>{unitId}</span></Tooltip>
          </div>
          <Button
            type="text"
            className="service-logs-close"
            icon={<X size={17} />}
            aria-label={t('app.close')}
            onClick={onClose}
          />
        </header>

        <div className="service-logs-toolbar">
          <div className="service-logs-search-row">
            <Input
              id="service-logs-search"
              name="service-logs-search"
              value={searchText}
              allowClear
              variant="borderless"
              className="service-logs-search"
              prefix={<Search size={14} />}
              status={search.invalidRegex ? 'error' : undefined}
              placeholder={t('workbench.services.logsSearchPlaceholder')}
              onChange={(event) => {
                setSearchText(event.target.value)
                setActiveMatch(0)
              }}
            />
            <span className="service-logs-match-count">
              {search.matches.length > 0 ? `${activeMatch + 1} / ${search.matches.length}` : '0 / 0'}
            </span>
            <Tooltip title={t('workbench.services.logsPrevious')}>
              <Button type="text" className="service-logs-tool" aria-label={t('workbench.services.logsPrevious')} disabled={search.matches.length === 0} icon={<ChevronUp size={15} />} onClick={() => moveMatch(-1)} />
            </Tooltip>
            <Tooltip title={t('workbench.services.logsNext')}>
              <Button type="text" className="service-logs-tool" aria-label={t('workbench.services.logsNext')} disabled={search.matches.length === 0} icon={<ChevronDown size={15} />} onClick={() => moveMatch(1)} />
            </Tooltip>
            <Tooltip title={t('workbench.services.logsCaseSensitive')}>
              <Button type="text" className={`service-logs-tool ${caseSensitive ? 'is-active' : ''}`} aria-label={t('workbench.services.logsCaseSensitive')} icon={<CaseSensitive size={16} />} onClick={() => setCaseSensitive((value) => !value)} />
            </Tooltip>
            <Tooltip title={t('workbench.services.logsRegex')}>
              <Button type="text" className={`service-logs-tool ${regexMode ? 'is-active' : ''}`} aria-label={t('workbench.services.logsRegex')} icon={<Regex size={15} />} onClick={() => setRegexMode((value) => !value)} />
            </Tooltip>
            <Tooltip title={t('workbench.services.logsWrap')}>
              <Button type="text" className={`service-logs-tool ${wrapLines ? 'is-active' : ''}`} aria-label={t('workbench.services.logsWrap')} icon={<WrapText size={15} />} onClick={() => setWrapLines((value) => !value)} />
            </Tooltip>
          </div>

          <div className="service-logs-option-row">
            <Segmented
              size="small"
              value={query.boot}
              options={[
                { value: 'current', label: t('workbench.services.logsCurrentBoot') },
                { value: 'all', label: t('workbench.services.logsAllBoots') },
              ]}
              onChange={(value) => applyRemoteQuery({ boot: value as SessionServiceLogQueryState['boot'] })}
            />
            <Select
              value={query.priority}
              className="service-logs-priority"
              classNames={{ popup: { root: 'service-logs-select-dropdown' } }}
              aria-label={t('workbench.services.logsPriority')}
              options={priorityOptions.map((priority) => ({
                value: priority,
                label: t(`workbench.services.priorities.${priority || 'all'}`),
              }))}
              onChange={(value) => applyRemoteQuery({ priority: value })}
            />
            <Select
              value={query.limit}
              className="service-logs-limit"
              classNames={{ popup: { root: 'service-logs-select-dropdown' } }}
              aria-label={t('workbench.services.logsLimit')}
              options={limitOptions.map((limit) => ({ value: limit, label: String(limit) }))}
              onChange={(value) => applyRemoteQuery({ limit: value })}
            />
            <Button
              className="service-logs-refresh"
              loading={loading}
              icon={<RefreshCw size={14} />}
              onClick={() => onRefresh(query, false)}
            >
              {t('workbench.services.logsRefresh')}
            </Button>
            <Button
              className="service-logs-refresh"
              disabled={loading || !logs?.cursor}
              icon={<ArrowDownToLine size={14} />}
              onClick={() => onRefresh(query, true)}
            >
              {t('workbench.services.logsLoadNew')}
            </Button>
          </div>
        </div>

        {search.invalidRegex ? <div className="service-logs-error">{t('workbench.services.logsInvalidRegex')}</div> : null}
        {error ? <div className="service-logs-error">{error}</div> : null}

        <div ref={consoleRef} className={`service-logs-console ${wrapLines ? 'is-wrap' : ''}`}>
          {entries.length === 0 && !loading ? (
            <div className="service-logs-empty">
              <FileClock size={24} />
              <span>{t('workbench.services.logsEmpty')}</span>
            </div>
          ) : null}
          {entries.map((entry, lineIndex) => (
            <ServiceLogLine
              key={entry.cursor || `${entry.timestamp}-${lineIndex}`}
              entry={entry}
              lineIndex={lineIndex}
              ranges={search.byLine[lineIndex] ?? []}
              activeMatch={activeMatch}
            />
          ))}
        </div>

        <footer className="service-logs-footer">
          <span>{t('workbench.services.logsLineCount', { count: entries.length })}</span>
          <span>{t('workbench.services.logsMatchCount', { count: search.matches.length })}</span>
          <span>{logs?.collected_at ? t('workbench.services.logsUpdatedAt', { time: formatLogTime(logs.collected_at, true) }) : t('workbench.services.updatedNever')}</span>
        </footer>
      </div>
    </Modal>
  )
}

function ServiceLogLine({
  entry,
  lineIndex,
  ranges,
  activeMatch,
}: {
  entry: SystemServiceLogEntry
  lineIndex: number
  ranges: LogMatchRange[]
  activeMatch: number
}) {
  return (
    <div className={`service-log-line is-priority-${entry.priority}`} data-service-log-line={lineIndex}>
      <time>{formatLogTime(entry.timestamp, false)}</time>
      <span className="service-log-source">
        {entry.command || '-'}{entry.pid ? ` · ${entry.pid}` : ''}
      </span>
      <code>{highlightMessage(entry.message, ranges, activeMatch)}</code>
    </div>
  )
}

function buildLogSearch(
  entries: SystemServiceLogEntry[],
  query: string,
  caseSensitive: boolean,
  regexMode: boolean,
): LogSearchResult {
  if (!query) {
    return { matches: [], byLine: {}, invalidRegex: false }
  }
  let expression: RegExp | null = null
  if (regexMode) {
    try {
      expression = new RegExp(query, caseSensitive ? 'g' : 'gi')
    } catch {
      return { matches: [], byLine: {}, invalidRegex: true }
    }
  }
  const matches: LogSearchResult['matches'] = []
  const byLine: LogSearchResult['byLine'] = {}
  entries.forEach((entry, lineIndex) => {
    const ranges = expression
      ? findRegexRanges(entry.message, expression)
      : findTextRanges(entry.message, query, caseSensitive)
    if (ranges.length === 0) {
      return
    }
    byLine[lineIndex] = ranges.map((range) => {
      const index = matches.length
      matches.push({ lineIndex, matchIndex: index })
      return { ...range, index }
    })
  })
  return { matches, byLine, invalidRegex: false }
}

function findTextRanges(text: string, query: string, caseSensitive: boolean): Array<{ start: number; end: number }> {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const ranges: Array<{ start: number; end: number }> = []
  let cursor = haystack.indexOf(needle)
  while (cursor >= 0) {
    ranges.push({ start: cursor, end: cursor + query.length })
    cursor = haystack.indexOf(needle, cursor + Math.max(query.length, 1))
  }
  return ranges
}

function findRegexRanges(text: string, expression: RegExp): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  expression.lastIndex = 0
  let match = expression.exec(text)
  while (match) {
    const value = match[0]
    ranges.push({ start: match.index, end: match.index + value.length })
    if (value.length === 0) {
      expression.lastIndex += 1
    }
    match = expression.exec(text)
  }
  return ranges
}

function highlightMessage(message: string, ranges: LogMatchRange[], activeMatch: number): ReactNode {
  if (ranges.length === 0) {
    return message || ' '
  }
  const nodes: ReactNode[] = []
  let cursor = 0
  ranges.forEach((range) => {
    if (range.start > cursor) {
      nodes.push(message.slice(cursor, range.start))
    }
    nodes.push(
      <mark key={`${range.start}-${range.end}`} className={range.index === activeMatch ? 'is-active' : undefined}>
        {message.slice(range.start, range.end) || ' '}
      </mark>,
    )
    cursor = range.end
  })
  if (cursor < message.length) {
    nodes.push(message.slice(cursor))
  }
  return nodes
}

function formatLogTime(value: string, includeDate: boolean): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value || '-'
  }
  return date.toLocaleString([], includeDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
