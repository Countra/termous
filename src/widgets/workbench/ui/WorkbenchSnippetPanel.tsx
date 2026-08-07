import { Button, Input, Tooltip } from 'antd'
import { ChevronDown, ChevronRight, Code2, FolderOpen, Play, Send, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CodeSnippet, CodeSnippetGroup } from '#entities/snippet'
import {
  SnippetFilterBar,
  SnippetList,
  type SnippetCatalogFilter,
  type SnippetTagSummary,
} from '#features/snippets'
import snippetStyles from './SnippetWorkbench.module.scss'

export interface WorkbenchSnippetGroup {
  id: string
  name: string
  snippets: CodeSnippet[]
}

interface WorkbenchSnippetPanelProps {
  filter: SnippetCatalogFilter
  query: string
  selectedTags: string[]
  groups: CodeSnippetGroup[]
  selectedGroupId: string
  availableTags: SnippetTagSummary[]
  filteredSnippets: CodeSnippet[]
  totalCount: number
  groupedSnippets: WorkbenchSnippetGroup[]
  collapsedGroupIds: ReadonlySet<string>
  actionBusy: boolean
  canSendSnippet: boolean
  onFilterChange: (filter: SnippetCatalogFilter) => void
  onQueryChange: (query: string) => void
  onSelectedTagsChange: (tags: string[]) => void
  onSelectedGroupChange: (groupId: string) => void
  onClear: () => void
  onToggleGroup: (groupId: string) => void
  onToggleFavorite: (snippet: CodeSnippet) => Promise<void>
  onSendSnippet: (snippet: CodeSnippet, execute: boolean) => Promise<void>
}

export function WorkbenchSnippetPanel({
  filter,
  query,
  selectedTags,
  groups,
  selectedGroupId,
  availableTags,
  filteredSnippets,
  totalCount,
  groupedSnippets,
  collapsedGroupIds,
  actionBusy,
  canSendSnippet,
  onFilterChange,
  onQueryChange,
  onSelectedTagsChange,
  onSelectedGroupChange,
  onClear,
  onToggleGroup,
  onToggleFavorite,
  onSendSnippet,
}: WorkbenchSnippetPanelProps) {
  const { t } = useTranslation()
  return (
    <section className={`snippet-send-panel ${snippetStyles['workbench-root']}`}>
      <div className="snippet-send-head">
        <div className="snippet-send-head-main">
          <span className="snippet-send-head-icon">
            <Code2 size={16} aria-hidden="true" />
          </span>
          <div>
            <h3>{t('snippets.sendPanelTitle')}</h3>
            <span>{t('snippets.sendPanelHint')}</span>
          </div>
        </div>
        <span className="snippet-send-head-count">{t('snippets.libraryCount', { count: filteredSnippets.length })}</span>
      </div>
      <div className="snippet-send-filter-shell">
        <SnippetFilterBar
          filter={filter}
          query={query}
          selectedTags={selectedTags}
          groups={groups}
          selectedGroupId={selectedGroupId}
          availableTags={availableTags}
          filteredCount={filteredSnippets.length}
          totalCount={totalCount}
          density="compact"
          onFilterChange={onFilterChange}
          onQueryChange={onQueryChange}
          onSelectedTagsChange={onSelectedTagsChange}
          onSelectedGroupChange={onSelectedGroupChange}
          onClear={onClear}
        />
      </div>
      {filteredSnippets.length === 0 ? (
        <SnippetList
          snippets={[]}
          totalCount={totalCount}
          density="compact"
          emptyDescription={t('snippets.emptyHint')}
          noResultsDescription={t('snippets.noFilterResults')}
        />
      ) : (
        <div className="snippet-workbench-grouped-list">
          {groupedSnippets.map((group) => {
            const collapsed = collapsedGroupIds.has(group.id)
            return (
              <section key={group.id} className="snippet-workbench-group">
                <button
                  type="button"
                  className="snippet-workbench-group-head"
                  aria-expanded={!collapsed}
                  onClick={() => onToggleGroup(group.id)}
                >
                  {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <FolderOpen size={14} />
                  <strong>{group.name}</strong>
                  <span>{group.snippets.length}</span>
                </button>
                {!collapsed ? (
                  <SnippetList
                    snippets={group.snippets}
                    totalCount={group.snippets.length}
                    density="compact"
                    emptyDescription={t('snippets.emptyHint')}
                    noResultsDescription={t('snippets.noFilterResults')}
                    renderActions={(snippet) => (
                      <>
                        <Tooltip title={snippet.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}>
                          <Button
                            type="text"
                            className={`snippet-workbench-action is-favorite ${snippet.favorite ? 'is-active' : ''}`}
                            disabled={actionBusy}
                            aria-label={snippet.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}
                            aria-pressed={snippet.favorite}
                            icon={<Star size={14} fill={snippet.favorite ? 'currentColor' : 'none'} />}
                            onClick={() => void onToggleFavorite(snippet)}
                          />
                        </Tooltip>
                        <Tooltip title={t('snippets.action.insert')}>
                          <Button
                            type="text"
                            className="snippet-workbench-action"
                            disabled={!canSendSnippet || actionBusy}
                            aria-label={t('snippets.action.insert')}
                            icon={<Play size={14} />}
                            onClick={() => void onSendSnippet(snippet, false)}
                          />
                        </Tooltip>
                        <Tooltip title={t('snippets.action.send')}>
                          <Button
                            type="text"
                            className="snippet-workbench-action"
                            disabled={!canSendSnippet || actionBusy}
                            aria-label={t('snippets.action.send')}
                            icon={<Send size={14} />}
                            onClick={() => void onSendSnippet(snippet, true)}
                          />
                        </Tooltip>
                      </>
                    )}
                  />
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function SnippetVariablePrompt({
  variables,
  onChange,
}: {
  variables: string[]
  onChange: (name: string, value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className={`snippet-variable-prompt ${snippetStyles['snippet-dialog-content']}`}>
      <p>{t('snippets.variablesHint')}</p>
      {variables.map((variable) => (
        <label className="field" key={variable}>
          <span className="field-label">{`{{${variable}}}`}</span>
          <Input autoFocus={variables[0] === variable} onChange={(event) => onChange(variable, event.target.value)} />
        </label>
      ))}
    </div>
  )
}

export function SnippetRiskDialog({ snippet, reasons }: { snippet: CodeSnippet; reasons: string[] }) {
  const { t } = useTranslation()
  return (
    <div className={`snippet-risk-dialog ${snippetStyles['snippet-dialog-content']}`}>
      <p>{t('snippets.riskConfirmDescription')}</p>
      <strong>{snippet.name}</strong>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{t(`snippets.riskReasons.${reason}`)}</li>
        ))}
      </ul>
    </div>
  )
}
