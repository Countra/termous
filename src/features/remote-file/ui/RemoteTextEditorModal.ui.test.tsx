import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntdApp, ConfigProvider } from 'antd'
import { EditorView } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { undo } from '@codemirror/commands'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { i18n } from '#shared/i18n'
import { defaultTerminalSettings } from '#entities/settings'
import { compileShortcutIndex, ShortcutRuntime, ShortcutRuntimeContextProvider } from '#entities/shortcuts'
import type { FileOperationTask, RemoteTextFile, RemoteTextSaveRequest } from '#entities/file'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { RemoteTextEditorModal } from './RemoteTextEditorModal'

const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
beforeAll(async () => {
  await i18n.changeLanguage('zh-CN')
  // jsdom 不实现文本范围布局，真实层级和几何尺寸由浏览器验收。
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => {
  for (const [key, value] of [['getClientRects', originalRects], ['getBoundingClientRect', originalBounds]] as const) {
    if (value) Object.defineProperty(Range.prototype, key, value)
    else Reflect.deleteProperty(Range.prototype, key)
  }
})

async function setup(readOnly = false) {
  let file: RemoteTextFile = {
    file_session_id: 'test', path: '/test.txt', name: 'test.txt', content: 'alpha alpha',
    size: 11, sha256: 'before', encoding: 'utf-8', line_ending: 'none', has_bom: false, loaded_at: '',
  }
  const task = { id: 'read', revision: 1, status: 'completed', type: 'read_text' } as FileOperationTask
  const save = vi.fn(async (_id: string, request: RemoteTextSaveRequest) => {
    file = { ...file, content: request.content, sha256: 'after', size: request.content.length }
    return { ...task, id: 'save', type: 'save_text' }
  })
  const api = {
    createFileSessionTextReadOperation: vi.fn(async () => task),
    createFileSessionTextSaveOperation: save,
    fileOperationResult: vi.fn(async (id: string) => id === 'save' ? { file: { ...file }, entry: { name: file.name } } : { ...file }),
    cancelFileOperation: vi.fn(async () => undefined),
  } as unknown as FileOperationGateway
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const runtime = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
  const tree = (readonly: boolean) => <ConfigProvider theme={{ token: { motion: false } }}><AntdApp>
    <ShortcutRuntimeContextProvider value={{ runtime, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
      <RemoteTextEditorModal api={api} open readOnly={readonly} fileSessionId="test" connectionGeneration={1}
        path="/test.txt" theme="dark" terminalSettings={defaultTerminalSettings} onClose={onClose} onSaved={onSaved} />
    </ShortcutRuntimeContextProvider>
  </AntdApp></ConfigProvider>
  const result = render(tree(readOnly))
  await waitFor(() => expect(document.querySelector('.cm-content')).toHaveTextContent('alpha alpha'))
  const editor = EditorView.findFromDOM(document.querySelector('.cm-content')!)!
  act(() => { openSearchPanel(editor) })
  const panel = screen.getByRole('search')
  return { ...result, editor, panel, ui: within(panel), tree, save, onSaved, onClose }
}

test('保存后保留搜索面板、替换输入和展开状态，不重建编辑器', async () => {
  const { editor, panel, ui, save, onSaved } = await setup()
  fireEvent.input(ui.getByRole('textbox', { name: '查找文本' }), { target: { value: 'alpha' } })
  fireEvent.click(ui.getByRole('button', { name: '展开或收起替换' }))
  fireEvent.input(ui.getByRole('textbox', { name: '替换为' }), { target: { value: 'beta' } })
  fireEvent.click(ui.getByRole('button', { name: '全部替换' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(save).toHaveBeenCalledWith('test', expect.objectContaining({ content: 'beta beta', base_sha256: 'before' }), expect.any(AbortSignal))
  expect(screen.getByRole('search')).toBe(panel)
  expect(ui.getByRole('textbox', { name: '替换为' })).toHaveValue('beta')
  expect(ui.getByRole('textbox', { name: '查找文本' })).toHaveValue('alpha')
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled())
  act(() => { undo(editor) })
  expect(editor.state.doc.toString()).toBe('alpha alpha')
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
})

test('只读仍可查找，输入法 Esc 不关闭弹窗，恢复可写后开放替换', async () => {
  const { editor, ui, rerender, tree, onClose } = await setup(true)
  expect(editor.state.readOnly).toBe(true)
  expect(editor.contentDOM).toHaveAttribute('tabindex', '0')
  const input = ui.getByRole('textbox', { name: '查找文本' })
  fireEvent.input(input, { target: { value: 'alpha' } })
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 27, isComposing: true })
  expect(onClose).not.toHaveBeenCalled()
  expect(ui.queryByRole('button', { name: '展开或收起替换' })).not.toBeInTheDocument()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(editor.state.selection.main.to).toBe(5)
  rerender(tree(false))
  expect(editor.state.readOnly).toBe(false)
  await waitFor(() => expect(ui.getByRole('button', { name: '展开或收起替换' })).toBeVisible())
})
