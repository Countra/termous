import { Button, Input, Modal, Popconfirm, Select, Tag, Tooltip } from 'antd'
import {
  ArrowLeft,
  Code2,
  FileCode2,
  Plus,
  Save,
  Star,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { CustomSelect } from '../../components/ui/CustomSelect'
import type { AppData, CodeSnippetInput, SnippetShell } from '../../types/domain'
import {
  SnippetFilterBar,
  SnippetList,
} from './SnippetCatalog'
import {
  buildSnippetTags,
  filterSnippets,
  type SnippetCatalogFilter,
} from './snippetCatalogUtils'
import {
  analyzeSnippetRisk,
  extractSnippetVariables,
  normalizeSnippetInput,
  normalizeSnippetTags,
  snippetToInput,
} from './snippetUtils'

interface SnippetsPageProps {
  data: AppData
  actionBusy: boolean
  onSave: (id: string | null, input: CodeSnippetInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

type SnippetView = 'library' | 'editor'
type SnippetIntent = { type: 'select'; id: string } | { type: 'create' }

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
  const initialSnippet = data.snippets[0]
  const initialForm = initialSnippet ? snippetToInput(initialSnippet) : blankSnippet
  const [filter, setFilter] = useState<SnippetCatalogFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(initialSnippet?.id ?? null)
  const [form, setForm] = useState<CodeSnippetInput>(initialForm)
  const [baseline, setBaseline] = useState<CodeSnippetInput>(initialForm)
  const [activeView, setActiveView] = useState<SnippetView>('library')
  const [pendingIntent, setPendingIntent] = useState<SnippetIntent | null>(null)
  const editing = data.snippets.find((snippet) => snippet.id === editingId)

  const availableTags = useMemo(() => buildSnippetTags(data.snippets), [data.snippets])
  const filteredSnippets = useMemo(
    () => filterSnippets(data.snippets, { filter, query, selectedTags }),
    [data.snippets, filter, query, selectedTags],
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
  const normalizedBaseline = useMemo(() => normalizeSnippetInput(baseline), [baseline])
  const dirty = useMemo(
    () => JSON.stringify(normalizedForm) !== JSON.stringify(normalizedBaseline),
    [normalizedBaseline, normalizedForm],
  )
  const risk = useMemo(() => analyzeSnippetRisk(normalizedForm.command), [normalizedForm.command])
  const variables = useMemo(() => extractSnippetVariables(normalizedForm.command), [normalizedForm.command])
  const canSave = Boolean(normalizedForm.name && normalizedForm.command)

  useEffect(() => {
    if (!editing || dirty) return
    const next = snippetToInput(editing)
    setForm(next)
    setBaseline(next)
  }, [dirty, editing])

  const applyIntent = (intent: SnippetIntent) => {
    if (intent.type === 'create') {
      setEditingId(null)
      setForm(blankSnippet)
      setBaseline(blankSnippet)
      setActiveView('editor')
      return
    }
    const snippet = data.snippets.find((item) => item.id === intent.id)
    if (!snippet) return
    const next = snippetToInput(snippet)
    setEditingId(snippet.id)
    setForm(next)
    setBaseline(next)
    setActiveView('editor')
  }

  const requestIntent = (intent: SnippetIntent) => {
    if (dirty) {
      setPendingIntent(intent)
      return
    }
    applyIntent(intent)
  }

  const clearFilters = () => {
    setFilter('all')
    setQuery('')
    setSelectedTags([])
  }

  const save = async () => {
    if (!canSave || actionBusy) return
    const targetId = editingId
    await onSave(targetId, normalizedForm)
    if (targetId) {
      setForm(normalizedForm)
      setBaseline(normalizedForm)
      return
    }
    setForm(blankSnippet)
    setBaseline(blankSnippet)
    setActiveView('library')
  }

  const remove = async () => {
    if (!editingId || actionBusy) return
    const currentIndex = data.snippets.findIndex((snippet) => snippet.id === editingId)
    const nextSnippet = data.snippets[currentIndex + 1] ?? data.snippets[currentIndex - 1]
    await onDelete(editingId)
    if (nextSnippet) applyIntent({ type: 'select', id: nextSnippet.id })
    else applyIntent({ type: 'create' })
  }

  return (
    <section className={`snippets-workspace is-${activeView}`}>
      <SnippetLibrary
        snippets={data.snippets}
        filteredSnippets={filteredSnippets}
        editingId={editingId}
        filter={filter}
        query={query}
        selectedTags={selectedTags}
        availableTags={availableTags}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onSelectedTagsChange={setSelectedTags}
        onClearFilters={clearFilters}
        onCreate={() => requestIntent({ type: 'create' })}
        onSelect={(id) => requestIntent({ type: 'select', id })}
      />
      <SnippetEditor
        form={form}
        editingId={editingId}
        actionBusy={actionBusy}
        dirty={dirty}
        canSave={canSave}
        riskReasons={risk.reasons}
        variables={variables}
        shellOptions={shellOptions}
        tagOptions={tagOptions}
        onFormChange={setForm}
        onBack={() => setActiveView('library')}
        onSave={() => void save()}
        onDelete={() => void remove()}
      />
      <Modal
        centered
        width={420}
        open={Boolean(pendingIntent)}
        title={t('snippets.discardTitle')}
        okText={t('snippets.discard')}
        cancelText={t('app.cancel')}
        okButtonProps={{ danger: true }}
        onCancel={() => setPendingIntent(null)}
        onOk={() => {
          const intent = pendingIntent
          setPendingIntent(null)
          if (intent) applyIntent(intent)
        }}
      >
        <p className="snippet-discard-copy">{t('snippets.discardDescription')}</p>
      </Modal>
    </section>
  )
}

function SnippetLibrary({
  snippets,
  filteredSnippets,
  editingId,
  filter,
  query,
  selectedTags,
  availableTags,
  onFilterChange,
  onQueryChange,
  onSelectedTagsChange,
  onClearFilters,
  onCreate,
  onSelect,
}: {
  snippets: AppData['snippets']
  filteredSnippets: AppData['snippets']
  editingId: string | null
  filter: SnippetCatalogFilter
  query: string
  selectedTags: string[]
  availableTags: ReturnType<typeof buildSnippetTags>
  onFilterChange: (value: SnippetCatalogFilter) => void
  onQueryChange: (value: string) => void
  onSelectedTagsChange: (value: string[]) => void
  onClearFilters: () => void
  onCreate: () => void
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <aside className="snippet-management-library">
      <header className="snippet-management-library-head">
        <div className="snippet-management-title">
          <span className="snippet-management-title-icon"><FileCode2 size={18} aria-hidden="true" /></span>
          <div>
            <h1>{t('snippets.title')}</h1>
            <span>{t('snippets.libraryCount', { count: snippets.length })}</span>
          </div>
        </div>
        <ConnectionActionButton className="snippet-create-button" onClick={onCreate} icon={<Plus size={16} />}>
          {t('snippets.add')}
        </ConnectionActionButton>
      </header>
      <SnippetFilterBar
        filter={filter}
        query={query}
        selectedTags={selectedTags}
        availableTags={availableTags}
        filteredCount={filteredSnippets.length}
        totalCount={snippets.length}
        density="management"
        onFilterChange={onFilterChange}
        onQueryChange={onQueryChange}
        onSelectedTagsChange={onSelectedTagsChange}
        onClear={onClearFilters}
      />
      <SnippetList
        snippets={filteredSnippets}
        totalCount={snippets.length}
        density="management"
        selectedId={editingId}
        emptyDescription={t('snippets.empty')}
        noResultsDescription={t('snippets.noFilterResults')}
        onSelect={(snippet) => onSelect(snippet.id)}
      />
    </aside>
  )
}

function SnippetEditor({
  form,
  editingId,
  actionBusy,
  dirty,
  canSave,
  riskReasons,
  variables,
  shellOptions,
  tagOptions,
  onFormChange,
  onBack,
  onSave,
  onDelete,
}: {
  form: CodeSnippetInput
  editingId: string | null
  actionBusy: boolean
  dirty: boolean
  canSave: boolean
  riskReasons: string[]
  variables: string[]
  shellOptions: Array<{ value: SnippetShell; label: string }>
  tagOptions: Array<{ value: string; label: string }>
  onFormChange: (form: CodeSnippetInput) => void
  onBack: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const risky = riskReasons.length > 0
  return (
    <section className="snippet-management-editor">
      <header className="snippet-management-editor-head">
        <div className="snippet-editor-identity">
          <Button
            type="text"
            className="snippet-editor-back"
            aria-label={t('snippets.backToList')}
            icon={<ArrowLeft size={16} aria-hidden="true" />}
            onClick={onBack}
          >
            {t('snippets.backToList')}
          </Button>
          <span className="snippet-editor-identity-icon"><Code2 size={18} aria-hidden="true" /></span>
          <div>
            <span>{editingId ? t('snippets.editor') : t('snippets.newSnippet')}</span>
            <h2>{form.name || t('snippets.newSnippet')}</h2>
          </div>
        </div>
        <div className="snippet-editor-status">
          {dirty ? <Tag className="snippet-dirty-tag">{t('snippets.unsaved')}</Tag> : null}
          <Tooltip title={form.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}>
            <Button
              type="text"
              className={`snippet-favorite-toggle ${form.favorite ? 'is-active' : ''}`}
              aria-label={form.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}
              aria-pressed={form.favorite}
              icon={<Star size={16} fill={form.favorite ? 'currentColor' : 'none'} />}
              onClick={() => onFormChange({ ...form, favorite: !form.favorite })}
            />
          </Tooltip>
        </div>
      </header>
      <div className="snippet-management-editor-scroll">
        <section className="snippet-editor-section snippet-editor-basics">
          <div className="snippet-editor-section-head">
            <div>
              <h3>{t('snippets.basic')}</h3>
              <span>{t('snippets.basicHint')}</span>
            </div>
          </div>
          <div className="snippet-editor-form-grid">
            <Field
              id="snippet-name"
              label={t('snippets.name')}
              value={form.name}
              onChange={(name) => onFormChange({ ...form, name })}
            />
            <CustomSelect
              id="snippet-shell"
              label={t('snippets.shellLabel')}
              value={form.shell}
              options={shellOptions}
              onChange={(shell) => onFormChange({ ...form, shell: shell as SnippetShell })}
            />
            <label className="field snippet-editor-wide-field">
              <span className="field-label">{t('snippets.description')}</span>
              <Input.TextArea
                id="snippet-description"
                value={form.description}
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder={t('snippets.descriptionPlaceholder')}
                onChange={(event) => onFormChange({ ...form, description: event.target.value })}
              />
            </label>
            <label className="field snippet-editor-wide-field snippet-tags-field">
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
                onChange={(tags) => onFormChange({ ...form, tags: normalizeSnippetTags(tags) })}
              />
            </label>
          </div>
        </section>
        <section className="snippet-editor-section snippet-editor-command-section">
          <div className="snippet-editor-section-head">
            <div>
              <h3>{t('snippets.command')}</h3>
              <span>{t('snippets.commandHint')}</span>
            </div>
            <Tag className="snippet-shell-tag">{t(`snippets.shell.${form.shell || 'any'}`)}</Tag>
          </div>
          <Input.TextArea
            id="snippet-command"
            className="snippet-command-input"
            value={form.command}
            rows={11}
            spellCheck={false}
            placeholder={t('snippets.commandPlaceholder')}
            onChange={(event) => onFormChange({ ...form, command: event.target.value })}
          />
          <div className="snippet-command-insights">
            <div className="snippet-command-insight">
              <Tags size={14} aria-hidden="true" />
              <span>{t('snippets.variables')}</span>
              {variables.length > 0 ? (
                <div className="snippet-command-variable-list">
                  {variables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>)}
                </div>
              ) : <small>{t('snippets.noVariables')}</small>}
            </div>
            <div className={`snippet-command-insight is-risk ${risky ? 'is-detected' : ''}`}>
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{risky ? t('snippets.riskDetected') : t('snippets.noRiskDetected')}</span>
              {risky ? (
                <Tooltip title={riskReasons.map((reason) => t(`snippets.riskReasons.${reason}`)).join(' · ')}>
                  <small>{t('snippets.riskCount', { count: riskReasons.length })}</small>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </section>
      </div>
      <footer className="snippet-management-editor-footer">
        <Popconfirm
          title={t('app.confirmDelete')}
          description={t('snippets.deleteHint')}
          okText={t('app.delete')}
          cancelText={t('app.cancel')}
          disabled={!editingId || actionBusy}
          onConfirm={onDelete}
        >
          <Button danger disabled={!editingId || actionBusy} icon={<Trash2 size={15} />}>
            {t('app.delete')}
          </Button>
        </Popconfirm>
        <ConnectionActionButton
          className="snippet-save-button"
          disabled={actionBusy || !canSave || !dirty}
          loading={actionBusy}
          icon={<Save size={15} />}
          onClick={onSave}
        >
          {t('app.save')}
        </ConnectionActionButton>
      </footer>
    </section>
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
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
