import { Compartment, EditorState, StateEffect } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { closeSearchPanel, getSearchQuery, openSearchPanel, replaceAll, searchKeymap, searchPanelOpen, setSearchQuery, SearchQuery } from '@codemirror/search'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { i18n } from '#shared/i18n'
import { textEditorSearch } from './searchPanel'

let view: EditorView | undefined
let host: HTMLDivElement | undefined
const writable = new Compartment()
const language = new Compartment()
const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalRangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')

beforeAll(() => {
  // jsdom 没有文本几何测量；补齐 CodeMirror 异步布局所需的接口，实际布局由浏览器验证。
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})

afterAll(() => {
  for (const [key, descriptor] of [
    ['getClientRects', originalRangeRects], ['getBoundingClientRect', originalRangeBounds],
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
    else Reflect.deleteProperty(Range.prototype, key)
  }
})

function setup(doc = 'alpha ALPHA alphabet\nalpha', readOnly = false) {
  host = document.createElement('div')
  document.body.append(host)
  view = new EditorView({ parent: host, state: EditorState.create({
    doc,
    extensions: [
      keymap.of(searchKeymap), EditorState.allowMultipleSelections.of(true),
      writable.of(EditorState.readOnly.of(readOnly)),
      language.of(textEditorSearch(i18n.getFixedT('zh-CN'))),
    ],
  }) })
  openSearchPanel(view)
  const panel = within(host).getByRole('search')
  const ui = within(panel)
  const input = ui.getByRole('textbox', { name: '查找文本' })
  return { editor: view, panel, ui, input }
}

afterEach(() => {
  view?.destroy()
  host?.remove()
  view = undefined
  host = undefined
})

test('搜索支持输入、选项、前后匹配与全部选择，Escape 只关闭搜索并回到编辑器', () => {
  const { editor, panel, ui, input } = setup()
  expect(input).toHaveFocus()
  fireEvent.input(input, { target: { value: 'alpha' } })
  fireEvent.click(ui.getByRole('button', { name: '区分大小写' }))
  fireEvent.click(ui.getByRole('button', { name: '全词匹配' }))
  expect(getSearchQuery(editor.state)).toMatchObject({ search: 'alpha', caseSensitive: true, wholeWord: true })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(editor.state.selection.main.from).toBe(0)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(editor.state.selection.main.from).toBe(21)
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(editor.state.selection.main.from).toBe(0)
  fireEvent.click(ui.getByRole('button', { name: '选择全部' }))
  expect(editor.state.selection.ranges).toHaveLength(2)
  input.focus()
  const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
  input.dispatchEvent(escape)
  expect(escape.defaultPrevented).toBe(true)
  expect(searchPanelOpen(editor.state)).toBe(false)
  expect(panel.isConnected).toBe(false)
  expect(editor.hasFocus).toBe(true)
})

test('替换行按需展开，替换复用原有命令且无效正则禁止执行', () => {
  const { editor, ui, input } = setup('alpha alpha')
  expect(ui.queryByRole('textbox', { name: '替换为' })).not.toBeInTheDocument()
  fireEvent.click(ui.getByRole('button', { name: '展开或收起替换' }))
  const replacement = ui.getByRole('textbox', { name: '替换为' })
  expect(replacement).toHaveFocus()
  fireEvent.input(input, { target: { value: 'alpha' } })
  fireEvent.input(replacement, { target: { value: 'beta' } })
  fireEvent.click(ui.getByRole('button', { name: '全部替换' }))
  expect(editor.state.doc.toString()).toBe('beta beta')
  fireEvent.click(ui.getByRole('button', { name: '正则表达式' }))
  fireEvent.input(input, { target: { value: '[' } })
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(ui.getByRole('status', { name: '正则表达式无效，请检查后重试。' })).toHaveTextContent('正则表达式无效')
  expect(ui.getByRole('button', { name: '全部替换' })).toBeDisabled()
  fireEvent.keyDown(replacement, { key: 'Enter' })
  expect(editor.state.doc.toString()).toBe('beta beta')
})

test('只读状态切换隐藏替换，语言切换与外部查询更新保留当前搜索', () => {
  const { editor, ui, input } = setup('alpha alpha')
  fireEvent.click(ui.getByRole('button', { name: '展开或收起替换' }))
  fireEvent.input(input, { target: { value: 'alpha' } })
  editor.dispatch({ effects: writable.reconfigure(EditorState.readOnly.of(true)) })
  expect(ui.queryByRole('textbox', { name: '替换为' })).not.toBeInTheDocument()
  expect(ui.queryByRole('button', { name: '展开或收起替换' })).not.toBeInTheDocument()
  expect(replaceAll(editor)).toBe(false)
  expect(editor.state.doc.toString()).toBe('alpha alpha')
  editor.dispatch({ effects: language.reconfigure(textEditorSearch(i18n.getFixedT('en-US'))) })
  // CodeMirror 在语言变化时重建视图，查询仍由原有编辑器状态保留。
  const translated = within(editor.dom).getByRole('search')
  const translatedInput = within(translated).getByRole('textbox', { name: 'Find text' })
  expect(translatedInput).toHaveValue('alpha')
  expect(within(translated).queryByRole('textbox', { name: 'Replace with' })).not.toBeInTheDocument()
  editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'beta', regexp: true })) })
  expect(translatedInput).toHaveValue('beta')
  expect(within(translated).getByRole('button', { name: 'Regular expression' })).toHaveAttribute('aria-pressed', 'true')
})

test('输入法组合期间不提交中间查询，结束后更新；输入框以外保留 Enter 激活行为', () => {
  const { editor, ui, input } = setup('中文')
  fireEvent.input(input, { target: { value: 'zhong' }, isComposing: true })
  expect(getSearchQuery(editor.state).search).toBe('')
  fireEvent.compositionEnd(input, { target: { value: '中文' } })
  expect(getSearchQuery(editor.state).search).toBe('中文')
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  ui.getByRole('button', { name: '区分大小写' }).dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

test('输入法确认与取消不冒泡关闭外层，普通 Escape 仍关闭搜索', () => {
  const { editor, input } = setup('中文')
  let escaped = false
  host!.addEventListener('keydown', () => { escaped = true })
  for (const key of ['Enter', 'Escape']) {
    fireEvent.keyDown(input, { key, isComposing: true })
    fireEvent.keyDown(input, { key, keyCode: 229 })
  }
  expect(escaped).toBe(false)
  expect(searchPanelOpen(editor.state)).toBe(true)
})

test('选中文本时无效正则的 Enter 不会把查询替换为选中文本', () => {
  const { editor, ui, input } = setup('alpha beta')
  editor.dispatch({ selection: { anchor: 0, head: 5 } })
  fireEvent.click(ui.getByRole('button', { name: '正则表达式' }))
  fireEvent.input(input, { target: { value: '[' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(getSearchQuery(editor.state).search).toBe('[')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(editor.state.doc.toString()).toBe('alpha beta')
})

test('只读切换时焦点不会遗留在隐藏的替换开关上', () => {
  const { editor, ui, input } = setup()
  ui.getByRole('button', { name: '展开或收起替换' }).focus()
  editor.dispatch({ effects: writable.reconfigure(EditorState.readOnly.of(true)) })
  expect(input).toHaveFocus()
})

test('异步语言规则变化后，全词匹配计数重新计算', async () => {
  const { editor, ui, input } = setup('foo foo-bar')
  fireEvent.input(input, { target: { value: 'foo' } })
  fireEvent.click(ui.getByRole('button', { name: '全词匹配' }))
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(count).toHaveTextContent('- / 2'))
  const data = new Compartment()
  editor.dispatch({ effects: StateEffect.appendConfig.of(data.of(EditorState.languageData.of(() => [{ wordChars: '-' }]))) })
  await waitFor(() => expect(count).toHaveTextContent('- / 1'))
  editor.dispatch({ effects: data.reconfigure([]) })
  await waitFor(() => expect(count).toHaveTextContent('- / 2'))
})

test('实时统计匹配，导航和回绕同步序号，选项变化重算', async () => {
  const { editor, ui, input } = setup()
  expect(ui.queryByRole('status', { name: '搜索匹配结果' })).not.toBeInTheDocument()
  fireEvent.input(input, { target: { value: 'alpha' } })
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(count).toHaveTextContent('- / 4'))
  fireEvent.click(ui.getByRole('button', { name: '下一个匹配（Enter）' }))
  expect(count).toHaveTextContent('1 / 4')
  fireEvent.click(ui.getByRole('button', { name: '上一个匹配（Shift+Enter）' }))
  expect(count).toHaveTextContent('4 / 4')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(count).toHaveTextContent('1 / 4')
  fireEvent.click(ui.getByRole('button', { name: '区分大小写' }))
  fireEvent.click(ui.getByRole('button', { name: '全词匹配' }))
  await waitFor(() => expect(count).toHaveTextContent('1 / 2'))
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(count).toHaveTextContent('2 / 2')
  editor.dispatch({ selection: { anchor: 6 } })
  expect(count).toHaveTextContent('- / 2')
})

test('文本修改与替换刷新计数，无结果、空查询和无效正则不会保留旧值', async () => {
  const { editor, ui, input } = setup('alpha alpha')
  fireEvent.input(input, { target: { value: 'alpha' } })
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(count).toHaveTextContent('- / 2'))
  editor.dispatch({ changes: { from: 0, to: 6 } })
  await waitFor(() => expect(count).toHaveTextContent('- / 1'))
  fireEvent.click(ui.getByRole('button', { name: '展开或收起替换' }))
  fireEvent.input(ui.getByRole('textbox', { name: '替换为' }), { target: { value: 'beta' } })
  expect(count).toHaveTextContent('- / 1')
  fireEvent.click(ui.getByRole('button', { name: '全部替换' }))
  await waitFor(() => expect(count).toHaveTextContent('0 / 0'))
  expect(count).toHaveAttribute('title', '未找到匹配项')
  fireEvent.input(input, { target: { value: '' } })
  expect(count).not.toBeVisible()
  fireEvent.click(ui.getByRole('button', { name: '正则表达式' }))
  fireEvent.input(input, { target: { value: '[' } })
  expect(count).not.toBeVisible()
})

test('重叠文本及跨行、零长度正则匹配沿用原生规则', async () => {
  const { editor, ui, input } = setup('aaa\nabc\nabc')
  fireEvent.input(input, { target: { value: 'aa' } })
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(count).toHaveTextContent('- / 2'))
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(editor.state.selection.main.from).toBe(1)
  expect(count).toHaveTextContent('2 / 2')
  fireEvent.click(ui.getByRole('button', { name: '正则表达式' }))
  fireEvent.input(input, { target: { value: 'abc\\nabc' } })
  await waitFor(() => expect(count).toHaveTextContent('- / 1'))
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(count).toHaveTextContent('1 / 1')
  fireEvent.input(input, { target: { value: '^' } })
  await waitFor(() => expect(count).toHaveTextContent('- / 3'))
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(count).toHaveTextContent('1 / 3')
})

test('快速输入取消旧统计，关闭后停止更新，重新打开恢复当前查询', async () => {
  const { editor, ui, input } = setup('alpha beta beta')
  fireEvent.input(input, { target: { value: 'alpha' } })
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  fireEvent.input(input, { target: { value: 'beta' } })
  await waitFor(() => expect(count).toHaveTextContent('- / 2'))
  fireEvent.input(input, { target: { value: 'alpha' } })
  closeSearchPanel(editor)
  openSearchPanel(editor)
  const reopened = within(editor.dom).getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(reopened).toHaveTextContent('- / 1'))
  expect(count).toHaveTextContent('…')
})

test('大量匹配明确显示统计上限，范围外的导航不误报序号', async () => {
  const { editor, ui, input } = setup('x '.repeat(10_001))
  fireEvent.input(input, { target: { value: 'x' } })
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(count).toHaveTextContent('- / 10000+'), { timeout: 3000 })
  expect(count.title).toContain('匹配项超过 10000 个')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(count).toHaveTextContent('1 / 10000+')
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(editor.state.selection.main.from).toBe(20_000)
  expect(count).toHaveTextContent('- / 10000+')
  editor.dispatch({ changes: { from: 20_000, to: 20_002 } })
  await waitFor(() => expect(count).toHaveTextContent('- / 10000'), { timeout: 3000 })
  expect(count.textContent).not.toContain('+')
})

test('全部选择超过原生命令上限时说明原因，修改查询后清除提示', () => {
  const { editor, ui, input } = setup('alpha '.repeat(1001))
  fireEvent.input(input, { target: { value: 'alpha' } })
  fireEvent.click(ui.getByRole('button', { name: '选择全部' }))
  expect(ui.getByRole('status', { name: /匹配项过多/ })).toBeVisible()
  expect(editor.state.selection.ranges).toHaveLength(1)
  fireEvent.input(input, { target: { value: 'beta' } })
  fireEvent.click(ui.getByRole('button', { name: '选择全部' }))
  expect(ui.queryByRole('status', { name: /匹配项过多/ })).not.toBeInTheDocument()
})

test('Unicode 规范化后的同一范围不重复计数', async () => {
  const { ui, input } = setup('ﬀ f')
  fireEvent.input(input, { target: { value: 'f' } })
  const count = ui.getByRole('status', { name: '搜索匹配结果' })
  await waitFor(() => expect(count).toHaveTextContent('- / 2'))
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(count).toHaveTextContent('1 / 2')
})
