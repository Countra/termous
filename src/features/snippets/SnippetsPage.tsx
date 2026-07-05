import { Button, Empty, Input, Popconfirm, Segmented, Select, Tag, Tooltip } from 'antd'
import {
  Code2,
  FileCode2,
  Pencil,
  Plus,
  Search,
  Star,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { CustomSelect } from '../../components/ui/CustomSelect'
import type { AppData, CodeSnippet, CodeSnippetInput, SnippetShell } from '../../types/domain'
import { analyzeSnippetRisk, extractSnippetVariables, normalizeSnippetInput, normalizeSnippetTags, snippetToInput } from './snippetUtils'

interface SnippetsPageProps {
  data: AppData
  actionBusy: boolean
  onSave: (id: string | null, input: CodeSnippetInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

type SnippetFilter = 'all' | 'favorites'

const blankSnippet: CodeSnippetInput = {
  name: '',
  description: '',
  command: '',
  tags: [],
  shell: 'any',
  favorite: false,
}

const snippetShells: SnippetShell[] = ['any', 'sh', 'bash', 'zsh', 'powershell', 'cmd']

export function SnippetsPage({ data, actionBusy, onSave, onDelete }: SnippetsPageProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<SnippetFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(data.snippets[0]?.id ?? null)
  const [form, setForm] = useState<CodeSnippetInput>(blankSnippet)
  const editing = data.snippets.find((snippet) => snippet.id === editingId)

  useEffect(() => {
    if (!editing) {
      if (editingId) {
        setEditingId(null)
      }
      return
    }
    setForm(snippetToInput(editing))
  }, [editing, editingId])

  const availableTags = useMemo(() => buildSnippetTags(data.snippets), [data.snippets])
  const selectedTagKeys = useMemo(() => selectedTags.map(tagKey), [selectedTags])
  const queryTokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  )
  const filteredSnippets = useMemo(
    () =>
      data.snippets.filter((snippet) =>
        snippetMatchesFilters(snippet, filter, queryTokens, selectedTagKeys),
      ),
    [data.snippets, filter, queryTokens, selectedTagKeys],
  )
  const shellOptions = useMemo(
    () => snippetShells.map((shell) => ({ value: shell, label: t(`snippets.shell.${shell}`) })),
    [t],
  )
  const tagOptions = useMemo(
    () => availableTags.map((tag) => ({ value: tag.label, label: `${tag.label} (${tag.count})` })),
    [availableTags],
  )
  const normalizedForm = useMemo(() => normalizeSnippetInput(form), [form])
  const risk = useMemo(() => analyzeSnippetRisk(normalizedForm.command), [normalizedForm.command])
  const variables = useMemo(() => extractSnippetVariables(normalizedForm.command), [normalizedForm.command])
  const canSave = Boolean(normalizedForm.name && normalizedForm.command)
  const hasFilters = filter !== 'all' || queryTokens.length > 0 || selectedTags.length > 0

  const save = async () => {
    if (!canSave) {
      return
    }
    await onSave(editingId, normalizedForm)
  }

  const createNew = () => {
    setEditingId(null)
    setForm(blankSnippet)
  }

  const clearFilters = () => {
    setFilter('all')
    setQuery('')
    setSelectedTags([])
  }

  return (
    <section className="page-grid snippets-grid">
      <aside className="list-panel snippet-list-panel snippet-library-panel">
        <div className="page-title-row compact-title">
          <div>
            <h1>{t('snippets.title')}</h1>
            <p>{t('snippets.subtitle')}</p>
          </div>
          <ConnectionActionButton onClick={createNew} icon={<Plus size={16} />}>
            {t('snippets.add')}
          </ConnectionActionButton>
        </div>
        <Segmented
          block
          className="segmented-control"
          value={filter}
          options={[
            { value: 'all', label: t('snippets.all') },
            { value: 'favorites', label: t('snippets.favorites') },
          ]}
          onChange={(value) => setFilter(value as SnippetFilter)}
        />
        <Input
          id="snippets-search"
          name="snippets-search"
          className="host-search-input snippet-search-input termous-search-input"
          value={query}
          allowClear
          variant="borderless"
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={t('snippets.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="snippet-filter-meta">
          <span>{t('snippets.filterResult', { count: filteredSnippets.length, total: data.snippets.length })}</span>
          {hasFilters ? (
            <Button type="text" size="small" className="host-filter-clear" onClick={clearFilters}>
              {t('hosts.clearFilters')}
            </Button>
          ) : null}
        </div>
        {availableTags.length > 0 ? (
          <div className="snippet-filter-tags" aria-label={t('snippets.tags')}>
            {availableTags.map((tag) => (
              <Tag.CheckableTag
                key={tag.key}
                className="host-filter-chip"
                checked={selectedTagKeys.includes(tag.key)}
                onChange={(checked) => {
                  setSelectedTags((current) =>
                    checked ? normalizeSnippetTags([...current, tag.label]) : current.filter((item) => tagKey(item) !== tag.key),
                  )
                }}
              >
                <span>{tag.label}</span>
                <small>{tag.count}</small>
              </Tag.CheckableTag>
            ))}
          </div>
        ) : null}
        <div className="snippet-library-section">
          <div className="panel-heading">
            <div>
              <h2>{t('snippets.list')}</h2>
              <span>{t('snippets.listHint')}</span>
            </div>
            <FileCode2 size={18} aria-hidden="true" />
          </div>
          {data.snippets.length === 0 ? (
            <div className="snippet-empty-slot">
              <Empty description={t('snippets.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : filteredSnippets.length === 0 ? (
            <div className="snippet-empty-slot">
              <Empty description={t('snippets.noFilterResults')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div className="data-list snippet-data-list">
              {filteredSnippets.map((snippet) => (
                <SnippetRow
                  key={snippet.id}
                  snippet={snippet}
                  active={snippet.id === editingId}
                  onSelect={() => setEditingId(snippet.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="editor-panel snippet-editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('snippets.editor')}</h2>
            <span>{editingId ? t('app.update') : t('app.create')}</span>
          </div>
          <div className="snippet-editor-heading-actions">
            <Tooltip title={form.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}>
              <Button
                type="text"
                className={`snippet-favorite-toggle ${form.favorite ? 'is-active' : ''}`}
                aria-label={form.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}
                aria-pressed={form.favorite}
                icon={<Star size={16} fill={form.favorite ? 'currentColor' : 'none'} />}
                onClick={() => setForm({ ...form, favorite: !form.favorite })}
              >
                {form.favorite ? t('snippets.favorited') : t('snippets.favorite')}
              </Button>
            </Tooltip>
            <Pencil size={18} aria-hidden="true" />
          </div>
        </div>
        <div className="editor-sections">
          <section className="form-section">
            <h3>{t('snippets.basic')}</h3>
            <div className="form-grid">
              <Field id="snippet-name" label={t('snippets.name')} value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <CustomSelect
                id="snippet-shell"
                label={t('snippets.shellLabel')}
                value={form.shell}
                options={shellOptions}
                onChange={(value) => setForm({ ...form, shell: value as SnippetShell })}
              />
              <label className="field field-wide">
                <span className="field-label">{t('snippets.description')}</span>
                <Input.TextArea
                  id="snippet-description"
                  name="snippet-description"
                  value={form.description}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <label className="field field-wide snippet-tags-field">
                <span className="field-label">{t('snippets.tags')}</span>
                <Select
                  id="snippet-tags"
                  mode="tags"
                  value={form.tags}
                  allowClear
                  tokenSeparators={[',']}
                  classNames={{ popup: { root: 'termous-select-popup' } }}
                  className="termous-select"
                  optionLabelProp="value"
                  placeholder={t('snippets.tagsPlaceholder')}
                  options={tagOptions}
                  onChange={(tags) => setForm({ ...form, tags: normalizeSnippetTags(tags) })}
                />
              </label>
            </div>
          </section>
          <section className="form-section">
            <h3>{t('snippets.command')}</h3>
            <label className="field field-wide">
              <span className="field-label">{t('snippets.command')}</span>
              <Input.TextArea
                id="snippet-command"
                name="snippet-command"
                className="snippet-command-input"
                value={form.command}
                autoSize={{ minRows: 7, maxRows: 12 }}
                onChange={(event) => setForm({ ...form, command: event.target.value })}
              />
            </label>
          </section>
          <section className="snippet-preview-panel">
            <div className="snippet-preview-head">
              <span>{t('snippets.preview')}</span>
              {risk.risky ? (
                <Tag className="snippet-risk-tag" icon={<TriangleAlert size={12} />}>
                  {t('snippets.riskDetected')}
                </Tag>
              ) : null}
            </div>
            <pre>{normalizedForm.command || t('snippets.noCommand')}</pre>
            {variables.length > 0 ? (
              <div className="snippet-variable-row">
                <Tags size={14} />
                <span>{t('snippets.variables')}</span>
                {variables.map((variable) => (
                  <code key={variable}>{`{{${variable}}}`}</code>
                ))}
              </div>
            ) : null}
          </section>
        </div>
        <div className="danger-zone">
          <span>{t('snippets.deleteHint')}</span>
          <Popconfirm
            title={t('app.confirmDelete')}
            description={t('snippets.deleteHint')}
            okText={t('app.delete')}
            cancelText={t('app.cancel')}
            disabled={!editingId || actionBusy}
            onConfirm={() => editingId && void onDelete(editingId)}
          >
            <Button danger className="danger-button" disabled={!editingId || actionBusy} icon={<Trash2 size={16} />}>
              {t('app.delete')}
            </Button>
          </Popconfirm>
        </div>
        <Button type="primary" className="primary-button full-width" disabled={actionBusy || !canSave} onClick={() => void save()}>
          {editingId ? t('app.update') : t('app.create')}
        </Button>
      </section>
    </section>
  )
}

function SnippetRow({ snippet, active, onSelect }: { snippet: CodeSnippet; active: boolean; onSelect: () => void }) {
  const { t } = useTranslation()
  const risk = analyzeSnippetRisk(snippet.command)
  return (
    <button type="button" className={`data-row snippet-row ${active ? 'is-active' : ''}`} onClick={onSelect}>
      <span className="row-icon">
        <Code2 size={16} aria-hidden="true" />
      </span>
      <span className="row-copy">
        <strong>
          {snippet.favorite ? <Star size={13} aria-hidden="true" /> : null}
          {snippet.name}
        </strong>
        <small>{snippet.description || snippet.command}</small>
        <span className="snippet-row-tags">
          <Tag className="soft-tag">{t(`snippets.shell.${snippet.shell || 'any'}`)}</Tag>
          {risk.risky ? <Tag className="snippet-risk-tag">{t('snippets.riskDetected')}</Tag> : null}
        </span>
      </span>
      <span className="row-trailing">
        <small>{t('snippets.useCount', { count: snippet.use_count ?? 0 })}</small>
      </span>
    </button>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Input id={id} name={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function buildSnippetTags(snippets: CodeSnippet[]) {
  const tagMap = new Map<string, { key: string; label: string; count: number }>()
  snippets.forEach((snippet) => {
    const seen = new Set<string>()
    normalizeSnippetTags(snippet.tags ?? []).forEach((tag) => {
      const key = tagKey(tag)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      const existing = tagMap.get(key)
      if (existing) {
        existing.count += 1
      } else {
        tagMap.set(key, { key, label: tag, count: 1 })
      }
    })
  })
  return Array.from(tagMap.values()).sort((left, right) => left.label.localeCompare(right.label))
}

function snippetMatchesFilters(snippet: CodeSnippet, filter: SnippetFilter, tokens: string[], selectedTagKeys: string[]) {
  if (filter === 'favorites' && !snippet.favorite) {
    return false
  }
  const tags = normalizeSnippetTags(snippet.tags ?? [])
  const tagKeys = new Set(tags.map(tagKey))
  if (selectedTagKeys.length > 0 && !selectedTagKeys.every((tag) => tagKeys.has(tag))) {
    return false
  }
  if (tokens.length === 0) {
    return true
  }
  const searchable = [snippet.name, snippet.description ?? '', snippet.command, snippet.shell, tags.join(' ')].join(' ').toLowerCase()
  return tokens.every((token) => searchable.includes(token))
}

function tagKey(value: string) {
  return value.trim().toLowerCase()
}
