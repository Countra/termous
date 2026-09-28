import { EditorState, type Extension } from '@codemirror/state'
import { type EditorView, type Panel, runScopeHandlers, type ViewUpdate } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, SearchCursor, SearchQuery, selectMatches, setSearchQuery } from '@codemirror/search'
import type { TFunction } from 'i18next'
import { createSearchPanelIcon, type SearchPanelIcon } from './searchPanelIcons'
import styles from './SearchPanel.module.scss'

const phraseKeys = {
  Find: 'find', Replace: 'replace', 'Match case': 'matchCase', 'Whole word': 'wholeWord',
  'Regular expression': 'regexp', Previous: 'previous', Next: 'next', 'Select all matches': 'selectAll',
  'Replace next': 'replaceNext', 'Replace all': 'replaceAll', 'Toggle replace': 'toggleReplace',
  'Close search': 'close', 'Invalid regular expression': 'invalidRegexp',
  'Search matches': 'matches', 'Counting matches': 'counting', 'No matches': 'noMatches',
  'Match $1 of $2': 'matchPosition', '$ matches; no current match': 'matchTotal',
  'Match count limited to $': 'countLimit',
  'Too many matches to select': 'selectLimit',
  'current match': 'currentMatch', 'on line': 'onLine',
  'replaced match on line $': 'replacedOnLine', 'replaced $ matches': 'replacedMatches',
} as const

const createSearchPanel = (view: EditorView) => new TextEditorSearchPanel(view)
const matchCountLimit = 10_000

export function textEditorSearch(t: TFunction): Extension {
  return [
    search({ top: true, createPanel: createSearchPanel }),
    EditorState.phrases.of(Object.fromEntries(Object.entries(phraseKeys).map(([phrase, key]) => [phrase, t(`files.textSearch.${key}`)]))),
  ]
}

class TextEditorSearchPanel implements Panel {
  readonly dom = document.createElement('div')
  readonly top = true
  private readonly searchInput = document.createElement('input')
  private readonly replaceInput = document.createElement('input')
  private readonly replaceRow = document.createElement('div')
  private readonly error = document.createElement('span')
  private readonly selectionNotice = document.createElement('span')
  private readonly matchCount = document.createElement('span')
  private matches: Array<{ from: number; to: number }> = []
  private countTimer: ReturnType<typeof setTimeout> | undefined
  private counting = false
  private countLimited = false
  private countWordChars: string | undefined
  private readonly labels: Array<{ element: HTMLElement; phrase: string; text: boolean }> = []
  private readonly actions: HTMLButtonElement[] = []
  private readonly toggles = new Map<'caseSensitive' | 'wholeWord' | 'regexp', HTMLButtonElement>()
  private readonly expand: HTMLButtonElement
  private expanded = false

  constructor(private readonly view: EditorView) {
    this.dom.className = styles.panel
    this.dom.setAttribute('role', 'search')
    const row = document.createElement('div')
    row.className = styles.row
    this.expand = this.button('Toggle replace', 'expand', () => {
      this.expanded = !this.expanded
      this.sync()
      if (this.expanded) this.replaceInput.focus()
    })
    this.expand.classList.add(styles.expand)
    this.prepareInput(this.searchInput, 'Find', 'search')
    this.searchInput.setAttribute('main-field', 'true')
    const controls = document.createElement('div')
    controls.className = styles.controls
    const field = document.createElement('div')
    field.className = styles.field
    const options = document.createElement('div')
    options.className = styles.options
    field.append(this.searchInput, options)
    for (const [key, phrase] of [
      ['caseSensitive', 'Match case'], ['wholeWord', 'Whole word'], ['regexp', 'Regular expression'],
    ] as const) {
      const toggle = this.button(phrase, key, () => {
        const query = getSearchQuery(view.state)
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, [key]: !query[key] })) })
      })
      this.toggles.set(key, toggle)
      options.append(toggle)
    }
    const navigation = document.createElement('div')
    navigation.className = styles.navigation
    this.matchCount.className = styles['match-count']
    this.matchCount.setAttribute('role', 'status')
    this.matchCount.setAttribute('aria-atomic', 'true')
    this.labels.push({ element: this.matchCount, phrase: 'Search matches', text: false })
    const selectAll = this.action('Select all matches', null, () => {
      const selected = selectMatches(view)
      // 原生命令超过多选上限会返回 false；区分无结果，避免按钮看似没有响应。
      this.selectionNotice.hidden = selected || !!getSearchQuery(view.state).getCursor(view.state).next().done
    })
    selectAll.classList.add(styles['select-all'])
    navigation.append(
      this.matchCount,
      this.action('Previous', 'previous', () => findPrevious(view)),
      this.action('Next', 'next', () => findNext(view)),
      selectAll,
    )
    controls.append(field, navigation)
    const close = this.button('Close search', 'close', () => closeSearchPanel(view))
    close.classList.add(styles.close)
    row.append(this.expand, controls, close)

    this.prepareInput(this.replaceInput, 'Replace', 'replace')
    this.replaceRow.className = styles['replace-row']
    this.replaceRow.append(this.replaceInput,
      this.action('Replace next', null, () => replaceNext(view)),
      this.action('Replace all', null, () => replaceAll(view)))
    this.error.className = styles.error
    this.error.setAttribute('role', 'status')
    this.labels.push({ element: this.error, phrase: 'Invalid regular expression', text: true })
    this.selectionNotice.className = styles.notice
    this.selectionNotice.setAttribute('role', 'status')
    this.selectionNotice.hidden = true
    this.labels.push({ element: this.selectionNotice, phrase: 'Too many matches to select', text: true })
    this.dom.append(row, this.replaceRow, this.error, this.selectionNotice)
    this.dom.addEventListener('keydown', (event) => {
      // 输入法确认和取消交给输入框，阻止 Esc 冒泡关闭外层编辑弹窗。
      if (event.isComposing || event.keyCode === 229) {
        event.stopPropagation()
        return
      }
      if (runScopeHandlers(view, event, 'search-panel')) {
        event.preventDefault()
        event.stopPropagation()
      } else if (event.key === 'Enter' && (event.target === this.searchInput || event.target === this.replaceInput)) {
        event.preventDefault()
        event.stopPropagation()
        this.commit()
        if (event.target === this.searchInput) (event.shiftKey ? findPrevious : findNext)(view)
        else if (event.target === this.replaceInput && !view.state.readOnly) replaceNext(view)
      }
    })
    this.sync()
    this.recount()
  }

  private button(phrase: string, icon: SearchPanelIcon | null, run: () => unknown) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = styles.button
    if (icon !== null) button.append(createSearchPanelIcon(icon))
    else button.classList.add(styles['text-button'])
    button.addEventListener('click', run)
    this.labels.push({ element: button, phrase, text: icon === null })
    return button
  }

  private action(phrase: string, icon: SearchPanelIcon | null, run: () => unknown) {
    const button = this.button(phrase, icon, run)
    this.actions.push(button)
    return button
  }

  private prepareInput(input: HTMLInputElement, phrase: string, name: string) {
    input.className = styles.input
    input.name = name
    input.type = 'text'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('form', '')
    this.labels.push({ element: input, phrase, text: false })
    input.addEventListener('input', (event) => { if (!(event as InputEvent).isComposing) this.commit() })
    input.addEventListener('compositionend', () => this.commit())
  }

  private commit() {
    const current = getSearchQuery(this.view.state)
    const query = new SearchQuery({ ...current, search: this.searchInput.value, replace: this.replaceInput.value })
    if (!query.eq(current)) this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  private sync() {
    const query = getSearchQuery(this.view.state)
    if (this.searchInput.value !== query.search) this.searchInput.value = query.search
    if (this.replaceInput.value !== query.replace) this.replaceInput.value = query.replace
    for (const [key, toggle] of this.toggles) toggle.setAttribute('aria-pressed', String(query[key]))
    const readonly = this.view.state.readOnly
    if (readonly && (this.replaceRow.contains(this.view.root.activeElement)
      || this.view.root.activeElement === this.expand)) this.searchInput.focus()
    this.expand.hidden = readonly
    this.expand.setAttribute('aria-expanded', String(this.expanded && !readonly))
    this.replaceRow.hidden = readonly || !this.expanded
    for (const action of this.actions) action.disabled = !query.valid
    const invalid = query.regexp && !!query.search && !query.valid
    this.searchInput.setAttribute('aria-invalid', String(invalid))
    this.error.hidden = !invalid
    for (const { element, phrase, text } of this.labels) {
      const label = this.view.state.phrase(phrase)
      if (text) element.textContent = label
      element.setAttribute('aria-label', label)
      if (element instanceof HTMLInputElement) element.placeholder = label
      else if (element instanceof HTMLButtonElement) element.title = label
    }
  }

  private recount() {
    clearTimeout(this.countTimer)
    this.countTimer = undefined
    this.matches = []
    this.countLimited = false
    this.selectionNotice.hidden = true
    const state = this.view.state
    const query = getSearchQuery(state)
    this.countWordChars = this.wordChars(state)
    this.counting = query.valid
    this.matchCount.hidden = !query.valid
    this.renderCount()
    if (!query.valid) return

    const cursor = query.getCursor(state)
    const scan = () => {
      this.countTimer = undefined
      const started = performance.now()
      // 复用原生查询规则；普通文本保留重叠项，避免向上查找选中的项没有序号。
      for (let scanned = 0; scanned < 500 && performance.now() - started < 8; scanned++) {
        const next = cursor instanceof SearchCursor ? cursor.nextOverlapping() : cursor.next()
        if (next.done) { this.counting = false; break }
        // Unicode 规范化可能将一个字符展开为多个相同匹配，不重复统计同一范围。
        const previous = this.matches[this.matches.length - 1]
        if (previous?.from === next.value.from && previous.to === next.value.to) continue
        if (this.matches.length === matchCountLimit) {
          this.countLimited = true
          this.counting = false
          break
        }
        this.matches.push({ from: next.value.from, to: next.value.to })
      }
      this.renderCount()
      if (this.counting) this.countTimer = setTimeout(scan, 16)
    }
    // 连续输入只统计最终查询；大批量匹配分片处理并限制缓存，关闭时取消。
    this.countTimer = setTimeout(scan, 80)
  }

  private renderCount() {
    const state = this.view.state
    this.matchCount.setAttribute('aria-busy', String(this.counting))
    if (this.counting) {
      this.matchCount.textContent = '…'
      this.matchCount.title = state.phrase('Counting matches')
      return
    }
    const selection = state.selection.main
    let low = 0, high = this.matches.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.matches[mid].from < selection.from) low = mid + 1
      else high = mid
    }
    const match = this.matches[low]
    const current = match?.from === selection.from && match.to === selection.to ? low + 1 : 0
    const total = `${this.matches.length}${this.countLimited ? '+' : ''}`
    this.matchCount.textContent = this.matches.length === 0 ? '0 / 0' : `${current || '-'} / ${total}`
    this.matchCount.title = this.countLimited
      ? state.phrase('Match count limited to $', String(matchCountLimit))
      : this.matches.length === 0 ? state.phrase('No matches')
        : current ? state.phrase('Match $1 of $2', String(current), total) : state.phrase('$ matches; no current match', total)
  }

  mount() { this.searchInput.focus(); this.searchInput.select() }

  destroy() { clearTimeout(this.countTimer) }

  private wordChars(state: EditorState) {
    return getSearchQuery(state).wholeWord
      ? state.languageDataAt<string>('wordChars', state.selection.main.head)[0] : undefined
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state)
    const previous = getSearchQuery(update.startState)
    if (update.state.readOnly !== update.startState.readOnly
      || !query.eq(previous)) this.sync()
    // 替换文本不影响匹配集合；上下导航只查缓存，不重新扫描全文。
    if (update.docChanged || query.search !== previous.search || query.caseSensitive !== previous.caseSensitive
      || query.regexp !== previous.regexp || query.wholeWord !== previous.wholeWord || query.test !== previous.test
      || query.literal !== previous.literal || this.wordChars(update.state) !== this.countWordChars) this.recount()
    else if (update.selectionSet) this.renderCount()
  }
}
