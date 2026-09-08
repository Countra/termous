import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '#shared/i18n'
import { TerminalAiCompletionPanel, type TerminalAiCompletionPanelProps } from './TerminalAiCompletionPanel.tsx'

function props(overrides: Partial<TerminalAiCompletionPanelProps> = {}): TerminalAiCompletionPanelProps {
  return {
    open: true, position: { left: 10, top: 20, maxWidth: 420, maxHeight: 460, placement: 'below' },
    themeMode: 'dark', prompt: '查找日志', onPromptChange: vi.fn(), state: 'idle',
    model: { status: 'ready', label: '默认模型' }, appendState: 'append',
    results: [], selectedResultId: overrides.results?.[overrides.results.length - 1]?.requestId ?? null, onSelectResult: vi.fn(),
    onGenerate: vi.fn(), onCancel: vi.fn(), onAppend: vi.fn(), onCopy: vi.fn(), onClose: vi.fn(), onOpenSettings: vi.fn(),
    ...overrides,
  }
}

const result = { requestId: 'r1', command: 'find . -name "*.log"', description: '查找当前目录的日志文件', model: { id: 'model-actual', name: '实际模型' } }
const secondResult = { ...result, requestId: 'r2', command: 'pwd', description: '查看当前目录' }
const panel = (value: TerminalAiCompletionPanelProps) => <I18nextProvider i18n={i18n}><TerminalAiCompletionPanel {...value} /></I18nextProvider>

function SelectablePanel({ value }: { value: TerminalAiCompletionPanelProps }) {
  const [selectedResultId, select] = useState(value.selectedResultId)
  return panel({ ...value, selectedResultId, onSelectResult: (id) => { value.onSelectResult(id); select(id) } })
}

beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

describe('终端 AI 命令浮层', () => {
  it('打开聚焦独立输入，Enter 生成且不把 IME 确认误当提交', () => {
    const value = props()
    render(panel(value))
    const input = screen.getByRole('textbox', { name: '描述你想做什么' })
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('maxlength', '4096')
    expect(input).toHaveAttribute('rows', '1')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-terminal-ai-completion')
    expect(screen.getByText('AI 命令补全')).toBeVisible()
    expect(screen.getByTitle('默认模型')).toHaveTextContent('默认模型')
    fireEvent.change(input, { target: { value: '查看磁盘' } })
    expect(value.onPromptChange).toHaveBeenCalledWith('查看磁盘')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(value.onGenerate).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(value.onGenerate).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(value.onGenerate).toHaveBeenCalledOnce()
  })

  it('Tab 覆盖独立滚动的说明与错误区，Escape 关闭且不传播到终端', async () => {
    const user = userEvent.setup()
    const errorMessage = 'Connection interrupted. Try again.'
    const value = props({ state: 'error', results: [result], errorMessage })
    const outsideKey = vi.fn()
    render(<div onKeyDown={outsideKey}>{panel(value)}</div>)
    const input = screen.getByRole('textbox')
    const description = screen.getByText(result.description)
    const error = screen.getByText(errorMessage)
    expect(description).toHaveAttribute('tabindex', '0')
    expect(error).toHaveAttribute('tabindex', '0')
    const targets = [input, screen.getByRole('listbox'), description, error, ...screen.getAllByRole('button')]
    const visited: Array<Element | null> = []
    expect(input).toHaveFocus()
    for (let index = 0; index < targets.length; index += 1) {
      await user.tab()
      visited.push(document.activeElement)
    }
    expect(new Set(visited)).toEqual(new Set(targets))
    expect(input).toHaveFocus()
    await user.tab({ shift: true })
    expect(visited[visited.length - 2]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(value.onClose).toHaveBeenCalledOnce()
    expect(outsideKey).not.toHaveBeenCalled()
  })

  it('输入法结束后的 229 Escape 不关闭面板，普通 Escape 仍可退出', () => {
    const value = props()
    render(panel(value))
    const input = screen.getByRole('textbox')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(value.onClose).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })
    expect(value.onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(value.onClose).toHaveBeenCalledOnce()
  })

  it('长需求在短面板内限制输入高度，并随可用空间恢复', () => {
    const value = props()
    const view = render(panel(value))
    const input = screen.getByRole('textbox')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 240 })
    const longPrompt = '长需求\n'.repeat(20)
    view.rerender(panel({ ...value, prompt: longPrompt }))
    expect(input).toHaveStyle({ height: '76px' })
    view.rerender(panel({ ...value, prompt: longPrompt, position: { ...value.position!, maxHeight: 84 } }))
    expect(input).toHaveStyle({ height: '38px' })
    expect(screen.getByRole('button', { name: '关闭 AI 命令补全' })).toBeEnabled()
    view.rerender(panel({ ...value, prompt: longPrompt }))
    expect(input).toHaveStyle({ height: '76px' })
  })

  it('生成中输入只读，显示取消按钮且不能通过 Enter 重复提交', async () => {
    const user = userEvent.setup()
    const value = props({ state: 'loading' })
    render(panel(value))
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '取消生成' })).toBeEnabled()
    expect(screen.getAllByRole('status').find((status) => status.textContent?.includes('正在生成命令'))).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(value.onGenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '取消生成' }))
    expect(value.onCancel).toHaveBeenCalledOnce()
  })

  it('结果使用纯文本，抬头显示实际模型，填入与复制分别回调', async () => {
    const user = userEvent.setup()
    const value = props({ state: 'ready', results: [{ ...result, command: 'echo "<img src=x>"' }] })
    render(panel(value))
    expect(screen.getByTitle('实际模型')).toHaveTextContent('实际模型')
    expect(screen.queryByText('默认模型')).not.toBeInTheDocument()
    expect(screen.getByText(result.description)).not.toHaveAttribute('title')
    expect(screen.getByText('echo "<img src=x>"').tagName).toBe('PRE')
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    await user.click(screen.getByRole('button', { name: '填入终端' }))
    expect(value.onAppend).toHaveBeenCalledOnce()
    expect(value.onCopy).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '复制' }))
    expect(value.onCopy).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '已复制' })).toBeVisible()
  })

  it('切换候选同步抬头模型，长模型名称保留完整提示', () => {
    const modelName = 'Provider / Long descriptive model name with an extended version identifier'
    const otherResult = { ...secondResult, model: { id: 'other-model', name: modelName } }
    const value = props({ state: 'ready', results: [result, otherResult], selectedResultId: result.requestId })
    render(<SelectablePanel value={value} />)
    expect(screen.getByTitle(result.model.name)).toHaveTextContent(result.model.name)
    fireEvent.click(screen.getAllByRole('option')[1])
    expect(screen.getByTitle(modelName)).toHaveTextContent(modelName)
    expect(screen.getAllByText(modelName)).toHaveLength(1)
    expect(screen.queryByText(result.model.name)).not.toBeInTheDocument()
    expect(screen.getByText(otherResult.description)).not.toHaveAttribute('title')
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' })
    expect(screen.getByTitle(result.model.name)).toHaveTextContent(result.model.name)
    expect(screen.queryByText(modelName)).not.toBeInTheDocument()
    expect(value.onAppend).not.toHaveBeenCalled()
  })

  it('列表只列命令，选中说明集中展示，紧凑图标仍有完整可访问名称', () => {
    const value = props({ state: 'ready', results: [result, secondResult], selectedResultId: result.requestId })
    render(<SelectablePanel value={value} />)
    const dialog = screen.getByRole('dialog', { name: 'AI 命令补全' })
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toBe(result.command)
    expect(options[1].textContent).toBe(secondResult.command)
    expect(screen.getAllByText(result.description)).toHaveLength(1)
    expect(screen.queryByText(secondResult.description)).not.toBeInTheDocument()
    expect(within(screen.getByRole('listbox')).queryByText(result.description)).not.toBeInTheDocument()
    expect(within(dialog).getAllByText('AI 命令补全')).toHaveLength(1)
    expect(within(dialog).getAllByText('实际模型')).toHaveLength(1)
    for (const label of ['描述你想做什么', '命令候选', '默认模型']) {
      expect(within(dialog).queryByText(label, { exact: true })).not.toBeInTheDocument()
    }
    expect(within(dialog).queryByText('2', { exact: true })).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('填入不会执行')
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(i18n.t('terminal.aiCompletion.inputHint'))
    expect(screen.getByRole('listbox')).toHaveAccessibleDescription(i18n.t('terminal.aiCompletion.listHint'))
    expect(screen.getAllByText(i18n.t('terminal.aiCompletion.inputHint'))).toHaveLength(1)
    expect(screen.getAllByText(i18n.t('terminal.aiCompletion.listHint'))).toHaveLength(1)
    for (const name of ['再生成一条', '关闭 AI 命令补全', '填入终端', '复制']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-label', name)
      expect(button.textContent).toBe('')
    }
    fireEvent.click(options[1])
    expect(screen.queryByText(result.description)).not.toBeInTheDocument()
    expect(screen.getAllByText(secondResult.description)).toHaveLength(1)
    expect(value.onAppend).not.toHaveBeenCalled()
  })

  it.each(['mismatch', 'exact', 'stale'] as const)('%s 不能填入但保留复制', async (appendState) => {
    const value = props({ state: 'ready', results: [result], appendState })
    render(panel(value))
    expect(screen.getByRole('button', { name: appendState === 'exact' ? '已在终端中' : '填入终端' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制' })).toBeEnabled()
    expect(screen.getByText(i18n.t(`terminal.aiCompletion.appendHint.${appendState}`))).toBeVisible()
    expect(value.onAppend).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
    fireEvent.doubleClick(screen.getByRole('option'))
    expect(value.onAppend).not.toHaveBeenCalled()
  })

  it('复制失败可重试，旧复制回执不会标记新结果', async () => {
    const user = userEvent.setup()
    const value = props({ state: 'ready', results: [result], onCopy: vi.fn().mockRejectedValueOnce(new Error('clipboard')) })
    const view = render(panel(value))
    await user.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByText('复制失败，请重试')).toBeVisible()
    let complete!: () => void
    value.onCopy = () => new Promise<void>((resolve) => { complete = resolve })
    view.rerender(panel(value))
    await user.click(screen.getByRole('button', { name: '复制' }))
    view.rerender(panel({ ...value, results: [result, { ...result, requestId: 'same-command-new-request' }], selectedResultId: 'same-command-new-request' }))
    await act(async () => { complete() })
    expect(screen.getByRole('button', { name: '复制' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument()
  })

  it('错误保留原文换行，模型不可用时阻止生成并提供设置入口', async () => {
    const user = userEvent.setup()
    const errorMessage = '  <img src=x>\n**原文**\t详情  '
    const value = props({ state: 'error', errorMessage, model: { status: 'unavailable', reason: 'model_unavailable' } })
    render(panel(value))
    const error = screen.getAllByRole('status').find((status) => status.textContent === errorMessage)
    expect(error).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '前往 AI 设置' }))
    expect(value.onOpenSettings).toHaveBeenCalledOnce()
  })

  it('英文、窄屏、未知模型原因和关闭状态具有明确回退', async () => {
    await i18n.changeLanguage('en-US')
    const value = props({ themeMode: 'light', model: { status: 'unavailable', reason: 'unknown-code' as never },
      position: { left: 0, top: 0, maxWidth: 220, maxHeight: 180, placement: 'above' } })
    const view = render(panel(value))
    expect(screen.getByRole('dialog', { name: 'AI command completion' })).toHaveStyle({ width: '220px', maxHeight: '180px' })
    expect(screen.getByText('AI command completion')).toBeVisible()
    expect(screen.getByText('The default model status could not be loaded.')).toBeVisible()
    expect(screen.queryByText('unknown-code')).not.toBeInTheDocument()
    view.rerender(panel({ ...value, open: false }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('点击候选只选择，列表方向键移动，Enter 只填入当前选项', () => {
    const value = props({ state: 'ready', results: [result, secondResult], selectedResultId: result.requestId })
    render(<SelectablePanel value={value} />)
    const list = screen.getByRole('listbox', { name: '命令候选' })
    const options = within(list).getAllByRole('option')
    fireEvent.click(options[1])
    expect(list).toHaveFocus()
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(list).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(value.onAppend).not.toHaveBeenCalled()
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(list, { key: 'Enter', keyCode: 229 })
    expect(value.onAppend).not.toHaveBeenCalled()
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(value.onAppend).toHaveBeenCalledOnce()
    expect(value.onGenerate).not.toHaveBeenCalled()
  })

  it('双击当前候选只填入一次，单击仍只选择', async () => {
    const user = userEvent.setup()
    const value = props({ state: 'ready', results: [result, secondResult], selectedResultId: result.requestId })
    render(<SelectablePanel value={value} />)
    const option = screen.getByRole('option', { name: secondResult.command })
    await user.click(option)
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(value.onAppend).not.toHaveBeenCalled()
    await user.dblClick(option)
    expect(value.onSelectResult).toHaveBeenLastCalledWith(secondResult.requestId)
    expect(value.onAppend).toHaveBeenCalledOnce()
    expect(value.onGenerate).not.toHaveBeenCalled()
  })

  it('输入方向键只在全文边界进入列表，Shift+Enter 保留换行操作', () => {
    const value = props({ prompt: '第一行\n第二行', state: 'ready', results: [result] })
    render(panel(value))
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    input.setSelectionRange(2, 2)
    const middleDown = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    fireEvent(input, middleDown)
    expect(middleDown.defaultPrevented).toBe(false)
    expect(input).toHaveFocus()
    const newline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    fireEvent(input, newline)
    expect(newline.defaultPrevented).toBe(false)
    expect(value.onGenerate).not.toHaveBeenCalled()
    input.setSelectionRange(input.value.length, input.value.length)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toHaveFocus()
    input.focus()
    input.setSelectionRange(0, 0)
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveFocus()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByRole('listbox')).toHaveFocus()
  })

  it('生成、失败、取消和编辑需求时已有候选仍可检查与填入', () => {
    const value = props({ state: 'loading', results: [result] })
    const view = render(panel(value))
    expect(screen.getByRole('option')).toHaveTextContent(result.command)
    expect(screen.getByRole('button', { name: '复制' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '填入终端' })).toBeEnabled()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
    expect(value.onAppend).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '取消生成' }))
    expect(value.onCancel).toHaveBeenCalledOnce()
    view.rerender(panel({ ...value, state: 'idle', prompt: '换一种写法' }))
    expect(screen.getByRole('option')).toHaveTextContent(result.command)
    view.rerender(panel({ ...value, state: 'error', errorMessage: 'Connection failed\nTry again.' }))
    expect(screen.getByRole('option')).toHaveTextContent(result.command)
    expect(screen.getByText('Connection failed Try again.').textContent).toBe('Connection failed\nTry again.')
  })

  it('修饰方向键保留文本选择，列表修饰键组合不选择或填入', () => {
    const value = props({ results: [result, secondResult], selectedResultId: result.requestId })
    render(panel(value))
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    const list = screen.getByRole('listbox')
    for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
      input.setSelectionRange(input.value.length, input.value.length)
      const down = new KeyboardEvent('keydown', { key: 'ArrowDown', [modifier]: true, bubbles: true, cancelable: true })
      fireEvent(input, down)
      expect(down.defaultPrevented).toBe(false)
      expect(input).toHaveFocus()
      fireEvent.keyDown(list, { key: 'ArrowDown', [modifier]: true })
      fireEvent.keyDown(list, { key: 'Enter', [modifier]: true })
    }
    expect(value.onSelectResult).not.toHaveBeenCalled()
    expect(value.onAppend).not.toHaveBeenCalled()
  })

  it('连续生成追加候选，并仅从需求控件把焦点交给新选项', () => {
    const value = props()
    const view = render(panel(value))
    const generate = screen.getByRole('button', { name: '生成命令' })
    generate.focus()
    view.rerender(panel({ ...value, state: 'loading' }))
    expect(screen.getByRole('button', { name: '取消生成' })).toHaveFocus()
    view.rerender(panel({ ...value, state: 'ready', results: [result], selectedResultId: result.requestId }))
    expect(screen.getByRole('listbox')).toHaveFocus()
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    screen.getByRole('textbox').focus()
    view.rerender(panel({ ...value, state: 'ready', results: [result, secondResult], selectedResultId: secondResult.requestId }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('listbox')).toHaveFocus()
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('新结果回包不抢候选操作焦点，也不覆盖运行时保留的手动选择', () => {
    const value = props({ state: 'loading', results: [result] })
    const view = render(panel(value))
    const list = screen.getByRole('listbox')
    list.focus()
    view.rerender(panel({ ...value, state: 'ready', results: [result, secondResult], selectedResultId: result.requestId }))
    expect(list).toHaveFocus()
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    const copy = screen.getByRole('button', { name: '复制' })
    copy.focus()
    view.rerender(panel({ ...value, state: 'ready', results: [result, secondResult, { ...secondResult, requestId: 'r3' }], selectedResultId: 'r3' }))
    expect(copy).toHaveFocus()
  })

  it('长列表选择会在自身滚动区显露候选且保留键盘焦点', () => {
    const results = Array.from({ length: 20 }, (_, index) => ({ ...result, requestId: `r${index}`, command: `echo ${index}` }))
    const value = props({ state: 'ready', results, selectedResultId: results[0].requestId })
    render(<SelectablePanel value={value} />)
    const list = screen.getByRole('listbox')
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 })
    const options = screen.getAllByRole('option')
    options.forEach((option, index) => {
      Object.defineProperty(option, 'offsetTop', { configurable: true, value: index * 70 })
      Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 70 })
    })
    fireEvent.click(options[19])
    expect(list).toHaveFocus()
    expect(list.scrollTop).toBe(1300)
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(options[18]).toHaveAttribute('aria-selected', 'true')
    expect(list.scrollTop).toBe(1260)
  })

  it('短面板的外层视口裁切列表时，选择后仍可看到当前命令', () => {
    const results = Array.from({ length: 3 }, (_, index) => ({ ...result, requestId: `r${index}`, command: `echo ${index}` }))
    render(<SelectablePanel value={props({ results, selectedResultId: results[0].requestId })} />)
    const list = screen.getByRole('listbox')
    const body = list.parentElement!.parentElement!
    const options = screen.getAllByRole('option')
    const rectangle = (top: number, height: number): DOMRect => ({
      x: 0, y: top, left: 0, top, right: 300, bottom: top + height, width: 300, height, toJSON: () => ({}),
    })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 90 })
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => rectangle(100, 90))
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => rectangle(100 - body.scrollTop, 200))
    options.forEach((option, index) => {
      Object.defineProperty(option, 'offsetTop', { configurable: true, value: index * 80 })
      Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 80 })
      vi.spyOn(option, 'getBoundingClientRect').mockImplementation(() => rectangle(100 - body.scrollTop + index * 80 - list.scrollTop, 80))
    })
    fireEvent.click(options[2])
    expect(list).toHaveFocus()
    expect(list.scrollTop).toBeGreaterThan(0)
    expect(body.scrollTop).toBeGreaterThan(0)
    expect(options[2].getBoundingClientRect().top).toBeGreaterThanOrEqual(body.getBoundingClientRect().top)
    expect(options[2].getBoundingClientRect().bottom).toBeLessThanOrEqual(body.getBoundingClientRect().bottom)
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[1].getBoundingClientRect().top).toBeGreaterThanOrEqual(body.getBoundingClientRect().top)
    expect(options[1].getBoundingClientRect().bottom).toBeLessThanOrEqual(body.getBoundingClientRect().bottom)
  })

  it('关闭后的迟到复制回执不会污染重新打开的候选', async () => {
    let complete!: () => void
    const value = props({ state: 'ready', results: [result], onCopy: () => new Promise<void>((resolve) => { complete = resolve }) })
    const view = render(panel(value))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    view.rerender(panel({ ...value, open: false, results: [], selectedResultId: null }))
    view.rerender(panel(value))
    await act(async () => { complete() })
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeEnabled()
  })
})
