import { Button, Input, Modal, Popconfirm, Select, Tag, Tooltip } from 'antd'
import {
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  FileCode2,
  Folder,
  FolderCog,
  Plus,
  Save,
  Star,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { GroupManagerModal } from '../../components/management/GroupManagerModal'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { CustomSelect } from '../../components/ui/CustomSelect'
import type { AppData, CodeSnippetGroup, CodeSnippetInput, GroupReorderItem, SnippetShell } from '../../types/domain'
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
  onCreateGroup: (name: string) => Promise<CodeSnippetGroup | undefined>
  onRenameGroup: (id: string, name: string) => Promise<CodeSnippetGroup | undefined>
  onDeleteGroup: (id: string) => Promise<void>
  onReorderGroups: (items: GroupReorderItem[]) => Promise<CodeSnippetGroup[] | undefined>
}

type SnippetView = 'library' | 'editor'
type SnippetIntent = { type: 'select'; id: string } | { type: 'create' }

const blankSnippet: CodeSnippetInput = {
  group_id: '',
  name: '',
  description: '',
  command: '',
  tags: [],
  shell: 'any',
  favorite: false,
}

const snippetShells: SnippetShell[] = ['any', 'sh', 'bash', 'zsh', 'powershell', 'cmd']

export function SnippetsPage({
  data,
  actionBusy,
  onSave,
  onDelete,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onReorderGroups,
}: SnippetsPageProps) {
  const { t } = useTranslation()
  const initialSnippet = data.snippets[0]
  const initialForm = initialSnippet ? snippetToInput(initialSnippet) : blankSnippet
  const [filter, setFilter] = useState<SnippetCatalogFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(initialSnippet?.id ?? null)
  const [form, setForm] = useState<CodeSnippetInput>(initialForm)
  const [baseline, setBaseline] = useState<CodeSnippetInput>(initialForm)
  const [activeView, setActiveView] = useState<SnippetView>('library')
  const [pendingIntent, setPendingIntent] = useState<SnippetIntent | null>(null)
  const editing = data.snippets.find((snippet) => snippet.id === editingId)
  const groupItemCounts = useMemo(() => data.snippets.reduce<Record<string, number>>((counts, snippet) => {
    if (snippet.group_id) counts[snippet.group_id] = (counts[snippet.group_id] ?? 0) + 1
    return counts
  }, {}), [data.snippets])

  const availableTags = useMemo(() => buildSnippetTags(data.snippets), [data.snippets])
  const filteredSnippets = useMemo(
    () => filterSnippets(data.snippets, { filter, query, selectedTags, groupId: selectedGroupId }),
    [data.snippets, filter, query, selectedGroupId, selectedTags],
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
    if (!selectedGroupId || selectedGroupId === '__ungrouped__') return
    if (!data.snippetGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId('')
    }
  }, [data.snippetGroups, selectedGroupId])

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
    setSelectedGroupId('')
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
        groups={data.snippetGroups}
        filteredSnippets={filteredSnippets}
        editingId={editingId}
        filter={filter}
        query={query}
        selectedTags={selectedTags}
        selectedGroupId={selectedGroupId}
        availableTags={availableTags}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onSelectedTagsChange={setSelectedTags}
        onSelectedGroupChange={setSelectedGroupId}
        onClearFilters={clearFilters}
        onCreate={() => requestIntent({ type: 'create' })}
        onManageGroups={() => setGroupManagerOpen(true)}
        onSelect={(id) => requestIntent({ type: 'select', id })}
      />
      <SnippetEditor
        key={editingId ?? 'new'}
        form={form}
        groups={data.snippetGroups}
        editingId={editingId}
        actionBusy={actionBusy}
        dirty={dirty}
        canSave={canSave}
        riskReasons={risk.reasons}
        variables={variables}
        shellOptions={shellOptions}
        tagOptions={tagOptions}
        onFormChange={setForm}
        onCreateGroup={onCreateGroup}
        onBack={() => setActiveView('library')}
        onSave={() => void save()}
        onDelete={() => void remove()}
      />
      <GroupManagerModal
        open={groupManagerOpen}
        groups={data.snippetGroups}
        actionBusy={actionBusy}
        title={t('snippets.manageGroups')}
        addLabel={t('snippets.addGroup')}
        namePlaceholder={t('snippets.groupNamePlaceholder')}
        emptyLabel={t('snippets.noGroups')}
        deleteTitle={t('snippets.deleteGroupTitle')}
        deleteDescription={t('snippets.deleteGroupHint')}
        saveLabel={t('app.save')}
        cancelLabel={t('app.cancel')}
        editLabel={t('app.edit')}
        deleteLabel={t('app.delete')}
        reorderLabel={t('app.reorder')}
        moveUpLabel={t('app.moveUp')}
        moveDownLabel={t('app.moveDown')}
        itemCounts={groupItemCounts}
        itemCountLabel={(count) => t('snippets.groupItemCount', { count })}
        onClose={() => setGroupManagerOpen(false)}
        onCreate={onCreateGroup}
        onRename={onRenameGroup}
        onDelete={onDeleteGroup}
        onReorder={onReorderGroups}
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
  groups,
  filteredSnippets,
  editingId,
  filter,
  query,
  selectedTags,
  selectedGroupId,
  availableTags,
  onFilterChange,
  onQueryChange,
  onSelectedTagsChange,
  onSelectedGroupChange,
  onClearFilters,
  onCreate,
  onManageGroups,
  onSelect,
}: {
  snippets: AppData['snippets']
  groups: CodeSnippetGroup[]
  filteredSnippets: AppData['snippets']
  editingId: string | null
  filter: SnippetCatalogFilter
  query: string
  selectedTags: string[]
  selectedGroupId: string
  availableTags: ReturnType<typeof buildSnippetTags>
  onFilterChange: (value: SnippetCatalogFilter) => void
  onQueryChange: (value: string) => void
  onSelectedTagsChange: (value: string[]) => void
  onSelectedGroupChange: (value: string) => void
  onClearFilters: () => void
  onCreate: () => void
  onManageGroups: () => void
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const groupedSnippets = useMemo(() => {
    const groupMap = new Map(groups.map((group) => [group.id, [] as AppData['snippets']]))
    const ungrouped: AppData['snippets'] = []
    filteredSnippets.forEach((snippet) => {
      const target = groupMap.get(snippet.group_id)
      if (target) target.push(snippet)
      else ungrouped.push(snippet)
    })
    return [
      ...groups.map((group) => ({ id: group.id, name: group.name, snippets: groupMap.get(group.id) ?? [] })),
      { id: '__ungrouped__', name: t('snippets.ungrouped'), snippets: ungrouped },
    ].filter((section) => section.snippets.length > 0)
  }, [filteredSnippets, groups, t])

  const toggleGroup = (id: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        <div className="snippet-management-head-actions">
          <Tooltip title={t('snippets.manageGroups')}>
            <Button
              className="snippet-group-manager-trigger"
              aria-label={t('snippets.manageGroups')}
              icon={<FolderCog size={16} />}
              onClick={onManageGroups}
            />
          </Tooltip>
          <ConnectionActionButton className="snippet-create-button" onClick={onCreate} icon={<Plus size={16} />}>
            {t('snippets.add')}
          </ConnectionActionButton>
        </div>
      </header>
      <SnippetFilterBar
        filter={filter}
        query={query}
        selectedTags={selectedTags}
        groups={groups}
        selectedGroupId={selectedGroupId}
        availableTags={availableTags}
        filteredCount={filteredSnippets.length}
        totalCount={snippets.length}
        density="management"
        onFilterChange={onFilterChange}
        onQueryChange={onQueryChange}
        onSelectedTagsChange={onSelectedTagsChange}
        onSelectedGroupChange={onSelectedGroupChange}
        onClear={onClearFilters}
      />
      {filteredSnippets.length === 0 ? (
        <SnippetList
          snippets={[]}
          totalCount={snippets.length}
          density="management"
          selectedId={editingId}
          emptyDescription={t('snippets.empty')}
          noResultsDescription={t('snippets.noFilterResults')}
          onSelect={(snippet) => onSelect(snippet.id)}
        />
      ) : (
        <div className="snippet-grouped-list">
          {groupedSnippets.map((section) => {
            const collapsed = collapsedGroups.has(section.id)
            return (
              <section key={section.id} className="snippet-group-section">
                <button
                  type="button"
                  className="snippet-group-section-head"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(section.id)}
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <Folder size={15} />
                  <strong>{section.name}</strong>
                  <span>{section.snippets.length}</span>
                </button>
                {!collapsed ? (
                  <SnippetList
                    snippets={section.snippets}
                    totalCount={section.snippets.length}
                    density="management"
                    selectedId={editingId}
                    emptyDescription={t('snippets.empty')}
                    noResultsDescription={t('snippets.noFilterResults')}
                    onSelect={(snippet) => onSelect(snippet.id)}
                  />
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </aside>
  )
}

function SnippetEditor({
  form,
  groups,
  editingId,
  actionBusy,
  dirty,
  canSave,
  riskReasons,
  variables,
  shellOptions,
  tagOptions,
  onFormChange,
  onCreateGroup,
  onBack,
  onSave,
  onDelete,
}: {
  form: CodeSnippetInput
  groups: CodeSnippetGroup[]
  editingId: string | null
  actionBusy: boolean
  dirty: boolean
  canSave: boolean
  riskReasons: string[]
  variables: string[]
  shellOptions: Array<{ value: SnippetShell; label: string }>
  tagOptions: Array<{ value: string; label: string }>
  onFormChange: (form: CodeSnippetInput) => void
  onCreateGroup: (name: string) => Promise<CodeSnippetGroup | undefined>
  onBack: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const risky = riskReasons.length > 0
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const commandInputRef = useRef<TextAreaRef>(null)
  const commandSelectionRef = useRef({ start: form.command.length, end: form.command.length })
  const [variableHelperOpen, setVariableHelperOpen] = useState(false)
  const [variableName, setVariableName] = useState('')
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const normalizedVariableName = variableName.trim()
  const variableNameValid = /^[a-zA-Z_][\w.-]{0,63}$/.test(normalizedVariableName)
  const normalizedGroupName = groupName.trim().replace(/\s+/g, ' ')

  const createGroup = async () => {
    if (!normalizedGroupName || creatingGroup) return
    setCreatingGroup(true)
    try {
      const group = await onCreateGroup(normalizedGroupName)
      if (!group) return
      onFormChange({ ...form, group_id: group.id })
      setGroupName('')
      setGroupCreatorOpen(false)
    } finally {
      setCreatingGroup(false)
    }
  }

  useEffect(() => {
    if (!variableHelperOpen) return

    const frame = requestAnimationFrame(() => {
      const container = editorScrollRef.current
      if (!container) return
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      container.scrollTo({
        top: container.scrollHeight,
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [variableHelperOpen])

  const rememberCommandSelection = (target: HTMLTextAreaElement) => {
    commandSelectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
    }
  }

  const insertVariable = (name: string) => {
    const normalizedName = name.trim()
    if (!/^[a-zA-Z_][\w.-]{0,63}$/.test(normalizedName)) return

    const token = `{{${normalizedName}}}`
    const start = Math.min(commandSelectionRef.current.start, form.command.length)
    const end = Math.min(commandSelectionRef.current.end, form.command.length)
    const command = `${form.command.slice(0, start)}${token}${form.command.slice(end)}`
    const nextCaret = start + token.length
    onFormChange({ ...form, command })
    commandSelectionRef.current = { start: nextCaret, end: nextCaret }
    setVariableName('')

    requestAnimationFrame(() => {
      commandInputRef.current?.focus()
      const nativeElement = commandInputRef.current?.nativeElement
      const textarea = nativeElement instanceof HTMLTextAreaElement
        ? nativeElement
        : nativeElement?.querySelector('textarea')
      textarea?.setSelectionRange(nextCaret, nextCaret)
    })
  }

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
      <div ref={editorScrollRef} className="snippet-management-editor-scroll">
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
            <div className="field snippet-editor-group-field snippet-editor-wide-field">
              <span className="field-label">{t('snippets.group')}</span>
              <div className="snippet-editor-group-control">
                <Select
                  value={form.group_id}
                  className="termous-select"
                  classNames={{ popup: { root: 'termous-select-popup' } }}
                  options={[
                    { value: '', label: t('snippets.ungrouped') },
                    ...groups.map((group) => ({ value: group.id, label: group.name })),
                  ]}
                  onChange={(group_id) => onFormChange({ ...form, group_id })}
                />
                <Tooltip title={t('snippets.addGroup')}>
                  <Button
                    aria-label={t('snippets.addGroup')}
                    icon={<Plus size={15} />}
                    onClick={() => setGroupCreatorOpen((open) => !open)}
                  />
                </Tooltip>
              </div>
            </div>
            {groupCreatorOpen ? (
              <div className="snippet-editor-group-create">
                <Input
                  autoFocus
                  value={groupName}
                  maxLength={64}
                  placeholder={t('snippets.groupNamePlaceholder')}
                  disabled={creatingGroup}
                  onChange={(event) => setGroupName(event.target.value)}
                  onPressEnter={() => void createGroup()}
                />
                <Button
                  type="primary"
                  loading={creatingGroup}
                  disabled={!normalizedGroupName}
                  onClick={() => void createGroup()}
                >
                  {t('app.create')}
                </Button>
                <Button
                  type="text"
                  disabled={creatingGroup}
                  onClick={() => {
                    setGroupCreatorOpen(false)
                    setGroupName('')
                  }}
                >
                  {t('app.cancel')}
                </Button>
              </div>
            ) : null}
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
            ref={commandInputRef}
            id="snippet-command"
            className="snippet-command-input"
            value={form.command}
            rows={11}
            spellCheck={false}
            placeholder={t('snippets.commandPlaceholder')}
            onChange={(event) => onFormChange({ ...form, command: event.target.value })}
            onSelect={(event) => rememberCommandSelection(event.currentTarget)}
          />
          <div className="snippet-command-insights">
            <div className="snippet-command-insight is-variables">
              <Tags size={14} aria-hidden="true" />
              <span>{t('snippets.variables')}</span>
              {variables.length > 0 ? (
                <div className="snippet-command-variable-list">
                  {variables.map((variable) => (
                    <Tooltip key={variable} title={t('snippets.insertVariableAgain')}>
                      <button type="button" onClick={() => insertVariable(variable)}>
                        <code>{`{{${variable}}}`}</code>
                      </button>
                    </Tooltip>
                  ))}
                </div>
              ) : <small>{t('snippets.noVariables')}</small>}
              <Button
                type="text"
                className={`snippet-variable-toggle ${variableHelperOpen ? 'is-active' : ''}`}
                icon={variableHelperOpen ? <ChevronUp size={13} /> : <Plus size={13} />}
                aria-expanded={variableHelperOpen}
                onClick={() => setVariableHelperOpen((open) => !open)}
              >
                {t('snippets.addVariable')}
              </Button>
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
          {variableHelperOpen ? (
            <div className="snippet-variable-helper">
              <div className="snippet-variable-helper-copy">
                <span className="snippet-variable-helper-icon"><Braces size={16} aria-hidden="true" /></span>
                <div>
                  <strong>{t('snippets.variableHelperTitle')}</strong>
                  <span>{t('snippets.variableHelperDescription')}</span>
                </div>
              </div>
              <div className="snippet-variable-examples" aria-label={t('snippets.variableSyntax')}>
                <span>{t('snippets.variableSyntax')}</span>
                <code>{'{{variable}}'}</code>
                <span>{t('snippets.variableExample')}</span>
                <code>{'tail -n {{lines}} "{{file}}"'}</code>
              </div>
              <div className="snippet-variable-compose">
                <Input
                  value={variableName}
                  prefix="{{"
                  suffix="}}"
                  status={normalizedVariableName && !variableNameValid ? 'error' : undefined}
                  placeholder={t('snippets.variableNamePlaceholder')}
                  aria-label={t('snippets.variableName')}
                  onChange={(event) => setVariableName(event.target.value)}
                  onPressEnter={() => insertVariable(variableName)}
                />
                <Button
                  className="snippet-variable-insert"
                  disabled={!variableNameValid}
                  icon={<Plus size={14} />}
                  onClick={() => insertVariable(variableName)}
                >
                  {t('snippets.insertVariable')}
                </Button>
              </div>
              <small className={normalizedVariableName && !variableNameValid ? 'is-invalid' : ''}>
                {normalizedVariableName && !variableNameValid
                  ? t('snippets.invalidVariableName')
                  : t('snippets.variableNameHint')}
              </small>
            </div>
          ) : null}
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
