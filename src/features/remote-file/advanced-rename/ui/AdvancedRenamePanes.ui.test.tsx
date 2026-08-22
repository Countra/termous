import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdvancedRenameExecutionResult, AdvancedRenamePreview } from '#entities/file'
import {
  createAdvancedRenameRule,
  duplicateAdvancedRenameRule,
} from '../model/advancedRenameModel'
import { AdvancedRenamePreviewPane } from './AdvancedRenamePreviewPane'
import { AdvancedRenameResultPane } from './AdvancedRenameResultPane'
import { AdvancedRenameRulePane } from './AdvancedRenameRulePane'
import { RuleConfigEditor } from './RuleConfigEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

beforeEach(() => {
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear()
})

describe('高级重命名编辑区域', () => {
  it('添加规则菜单保持紧凑并在悬停时展示说明', async () => {
    render(
      <AdvancedRenameRulePane
        rules={[createAdvancedRenameRule('template')]}
        order={{ by: 'selection', direction: 'asc' }}
        variableDefinitions={[]}
        variables={{}}
        variableDefinitionErrors={[]}
        ruleDiagnostics={{}}
        disabled={false}
        onAddRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onDuplicateRule={vi.fn()}
        onMoveRule={vi.fn()}
        onOrderChange={vi.fn()}
        onVariableDefinitionsChange={vi.fn()}
        onVariablesChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /files\.advancedRename\.rules\.add/ }))
    const regexChoice = await screen.findByLabelText(
      'files.advancedRename.ruleKind.regex: files.advancedRename.ruleDescription.regex',
    )
    expect(screen.queryByText('files.advancedRename.ruleDescription.regex')).not.toBeInTheDocument()

    fireEvent.mouseEnter(regexChoice)
    expect(await screen.findByText('files.advancedRename.ruleDescription.regex')).toBeInTheDocument()
  })

  it('新增正则规则时使用兼容的替换规则结构并自动展开', async () => {
    const first = createAdvancedRenameRule('template')
    const props = {
      order: { by: 'selection' as const, direction: 'asc' as const },
      variableDefinitions: [],
      variables: {},
      variableDefinitionErrors: [],
      ruleDiagnostics: {},
      disabled: false,
      onAddRule: vi.fn(),
      onUpdateRule: vi.fn(),
      onRemoveRule: vi.fn(),
      onDuplicateRule: vi.fn(),
      onMoveRule: vi.fn(),
      onOrderChange: vi.fn(),
      onVariableDefinitionsChange: vi.fn(),
      onVariablesChange: vi.fn(),
    }
    const view = render(<AdvancedRenameRulePane {...props} rules={[first]} />)
    const regexRule = createAdvancedRenameRule('regex')

    view.rerender(<AdvancedRenameRulePane {...props} rules={[first, regexRule]} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /files\.advancedRename\.ruleKind\.regex/ })).toHaveAttribute('aria-expanded', 'true')
    })
    expect(regexRule.kind).toBe('replace')
    if (regexRule.kind !== 'replace') {
      throw new Error('正则入口应创建 replace 规则')
    }
    expect(regexRule.config.regex).toBe(true)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('再次点击已展开规则时稳定收起且不会触发滚动', async () => {
    const rule = createAdvancedRenameRule('template')
    render(
      <AdvancedRenameRulePane
        rules={[rule]}
        order={{ by: 'selection', direction: 'asc' }}
        variableDefinitions={[]}
        variables={{}}
        variableDefinitionErrors={[]}
        ruleDiagnostics={{}}
        disabled={false}
        onAddRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onDuplicateRule={vi.fn()}
        onMoveRule={vi.fn()}
        onOrderChange={vi.fn()}
        onVariableDefinitionsChange={vi.fn()}
        onVariablesChange={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('button', {
      name: /files\.advancedRename\.ruleKind\.template/,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.queryByLabelText('files.advancedRename.fields.template')).not.toBeInTheDocument()
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('点击复制后仅展开新副本并执行一次定位', async () => {
    const first = createAdvancedRenameRule('template')
    const duplicated = duplicateAdvancedRenameRule(first)
    const props = {
      order: { by: 'selection' as const, direction: 'asc' as const },
      variableDefinitions: [],
      variables: {},
      variableDefinitionErrors: [],
      ruleDiagnostics: {},
      disabled: false,
      onAddRule: vi.fn(),
      onUpdateRule: vi.fn(),
      onRemoveRule: vi.fn(),
      onDuplicateRule: vi.fn(),
      onMoveRule: vi.fn(),
      onOrderChange: vi.fn(),
      onVariableDefinitionsChange: vi.fn(),
      onVariablesChange: vi.fn(),
    }
    const view = render(<AdvancedRenameRulePane {...props} rules={[first]} />)
    props.onDuplicateRule.mockImplementation(() => {
      view.rerender(<AdvancedRenameRulePane {...props} rules={[first, duplicated]} />)
    })

    fireEvent.click(screen.getByRole('button', {
      name: 'files.advancedRename.rules.duplicate',
    }))

    await waitFor(() => {
      const toggles = screen.getAllByRole('button', {
        name: /files\.advancedRename\.ruleKind\.template/,
      })
      expect(toggles).toHaveLength(2)
      expect(toggles[0]).toHaveAttribute('aria-expanded', 'false')
      expect(toggles[1]).toHaveAttribute('aria-expanded', 'true')
    })
    expect(props.onDuplicateRule).toHaveBeenCalledWith(first.id)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('条件开关完整展开并收起条件字段', () => {
    const initialRule = createAdvancedRenameRule('template')
    const onUpdateRule = vi.fn()
    const props = {
      order: { by: 'selection' as const, direction: 'asc' as const },
      variableDefinitions: [],
      variables: {},
      variableDefinitionErrors: [],
      ruleDiagnostics: {},
      disabled: false,
      onAddRule: vi.fn(),
      onUpdateRule,
      onRemoveRule: vi.fn(),
      onDuplicateRule: vi.fn(),
      onMoveRule: vi.fn(),
      onOrderChange: vi.fn(),
      onVariableDefinitionsChange: vi.fn(),
      onVariablesChange: vi.fn(),
    }
    const view = render(<AdvancedRenameRulePane {...props} rules={[initialRule]} />)
    onUpdateRule.mockImplementation((nextRule: typeof initialRule) => {
      view.rerender(<AdvancedRenameRulePane {...props} rules={[nextRule]} />)
    })

    const toggle = screen.getByRole('switch', {
      name: 'files.advancedRename.condition.title',
    })
    fireEvent.click(toggle)

    expect(screen.getByRole('group', {
      name: 'files.advancedRename.condition.kinds',
    })).toBeInTheDocument()
    expect(screen.getByLabelText('files.advancedRename.condition.name')).toBeInTheDocument()
    expect(screen.getByText('files.advancedRename.fields.matchMode')).toBeInTheDocument()
    expect(screen.getByText('files.advancedRename.matchMode.contains')).toBeInTheDocument()
    expect(screen.getByText('files.advancedRename.matchMode.regex')).toBeInTheDocument()
    expect(screen.getByRole('switch', {
      name: 'files.advancedRename.fields.caseSensitive',
    })).toBeInTheDocument()
    expect(screen.getByLabelText('files.advancedRename.condition.extensions')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.queryByRole('group', {
      name: 'files.advancedRename.condition.kinds',
    })).not.toBeInTheDocument()
  })

  it('编辑变量名时保持输入框挂载和焦点', () => {
    function VariableEditorHarness() {
      const [variableDefinitions, setVariableDefinitions] = useState([{
        name: 'value1',
        label: '变量 1',
        description: '',
        default_value: '',
        required: false,
      }])
      return (
        <AdvancedRenameRulePane
          rules={[createAdvancedRenameRule('template')]}
          order={{ by: 'selection', direction: 'asc' }}
          variableDefinitions={variableDefinitions}
          variables={{}}
          variableDefinitionErrors={[null]}
          ruleDiagnostics={{}}
          disabled={false}
          onAddRule={vi.fn()}
          onUpdateRule={vi.fn()}
          onRemoveRule={vi.fn()}
          onDuplicateRule={vi.fn()}
          onMoveRule={vi.fn()}
          onOrderChange={vi.fn()}
          onVariableDefinitionsChange={setVariableDefinitions}
          onVariablesChange={vi.fn()}
        />
      )
    }

    render(<VariableEditorHarness />)
    const nameInput = screen.getByLabelText('files.advancedRename.variables.name')
    nameInput.focus()

    fireEvent.change(nameInput, { target: { value: 'release' } })

    expect(screen.getByLabelText('files.advancedRename.variables.name')).toBe(nameInput)
    expect(nameInput).toHaveFocus()
    expect(nameInput).toHaveValue('release')
  })

  it('拖动规则组件只在放下时提交一次最终顺序', () => {
    const first = createAdvancedRenameRule('template')
    const second = createAdvancedRenameRule('replace')
    const third = createAdvancedRenameRule('sequence')
    const onMoveRule = vi.fn()
    render(
      <AdvancedRenameRulePane
        rules={[first, second, third]}
        order={{ by: 'selection', direction: 'asc' }}
        variableDefinitions={[]}
        variables={{}}
        variableDefinitionErrors={[]}
        ruleDiagnostics={{}}
        disabled={false}
        onAddRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onDuplicateRule={vi.fn()}
        onMoveRule={onMoveRule}
        onOrderChange={vi.fn()}
        onVariableDefinitionsChange={vi.fn()}
        onVariablesChange={vi.fn()}
      />,
    )

    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      setDragImage: vi.fn(),
    }
    const sourceToggle = screen.getByRole('button', {
      name: /files\.advancedRename\.ruleKind\.template/,
    })
    const source = sourceToggle.closest('article')
    const targetToggle = screen.getByRole('button', {
      name: /files\.advancedRename\.ruleKind\.sequence/,
    })
    const target = targetToggle.closest('article')
    const sourceHeading = source?.querySelector('[data-advanced-rename-rule-heading]')
    const dragIndicator = source?.querySelector('[data-advanced-rename-drag-indicator]')
    expect(source).toBeInstanceOf(HTMLElement)
    expect(sourceHeading).toBeInstanceOf(HTMLElement)
    expect(dragIndicator).toBeInstanceOf(HTMLElement)
    expect(target).toBeInstanceOf(HTMLElement)
    expect(sourceToggle).toHaveAttribute('data-advanced-rename-drag-allow', 'true')
    vi.spyOn(target as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      bottom: 200,
      height: 100,
      left: 0,
      right: 400,
      top: 100,
      width: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(screen.getAllByRole('button', {
      name: 'files.advancedRename.rules.duplicate',
    })[0])
    fireEvent.dragStart(source as HTMLElement, { dataTransfer })
    expect(dataTransfer.setDragImage).not.toHaveBeenCalled()

    fireEvent.pointerDown(sourceToggle)
    fireEvent.dragStart(source as HTMLElement, { dataTransfer })
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(sourceHeading, 28, 24)
    fireEvent.dragOver(target as HTMLElement, { clientY: 180, dataTransfer })
    expect(onMoveRule).not.toHaveBeenCalled()

    fireEvent.drop(target as HTMLElement, { clientY: 180, dataTransfer })

    expect(onMoveRule).toHaveBeenCalledTimes(1)
    expect(onMoveRule).toHaveBeenCalledWith(first.id, 2)
    expect(source).toHaveAttribute('draggable', 'true')
    expect(screen.queryByRole('button', { name: 'app.reorder' })).not.toBeInTheDocument()
  })

  it('规则达到 32 条时禁用所有复制入口', () => {
    const rules = Array.from({ length: 32 }, () => createAdvancedRenameRule('template'))
    render(
      <AdvancedRenameRulePane
        rules={rules}
        order={{ by: 'selection', direction: 'asc' }}
        variableDefinitions={[]}
        variables={{}}
        variableDefinitionErrors={[]}
        ruleDiagnostics={{}}
        disabled={false}
        onAddRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onDuplicateRule={vi.fn()}
        onMoveRule={vi.fn()}
        onOrderChange={vi.fn()}
        onVariableDefinitionsChange={vi.fn()}
        onVariablesChange={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', {
      name: 'files.advancedRename.rules.duplicate',
    })).toHaveLength(32)
    expect(screen.getAllByRole('button', {
      name: 'files.advancedRename.rules.duplicate',
    }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('数值规则字段在前端阻止越界、小数和零步长', () => {
    const onChange = vi.fn()
    const createdInsertRule = createAdvancedRenameRule('insert')
    if (createdInsertRule.kind !== 'insert') {
      throw new Error('插入规则工厂应返回 insert 规则')
    }
    const insertRule = {
      ...createdInsertRule,
      config: { text: '-', position: 'index' as const, index: 0, target: 'stem' as const },
    }
    const view = render(
      <RuleConfigEditor
        rule={insertRule}
        variableDefinitions={[]}
        disabled={false}
        onChange={onChange}
      />,
    )
    const insertIndex = screen.getByLabelText('files.advancedRename.fields.index')

    fireEvent.change(insertIndex, { target: { value: '-1' } })
    fireEvent.change(insertIndex, { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()

    const sequenceRule = createAdvancedRenameRule('sequence')
    if (sequenceRule.kind !== 'sequence') {
      throw new Error('序号规则工厂应返回 sequence 规则')
    }
    view.rerender(
      <RuleConfigEditor
        rule={sequenceRule}
        variableDefinitions={[]}
        disabled={false}
        onChange={onChange}
      />,
    )
    const step = screen.getByLabelText('files.advancedRename.fields.step')
    fireEvent.change(step, { target: { value: '0' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(step, { target: { value: '-2' } })
    expect(onChange).toHaveBeenCalledWith({
      ...sequenceRule,
      config: { ...sequenceRule.config, step: -2 },
    })
  })

  it('服务端省略 diagnostics 时仍渲染预览行', () => {
    const preview: AdvancedRenamePreview = {
      plan_hash: 'plan-1',
      items: [{
        source_path: '/srv/demo.txt',
        original_name: 'demo.txt',
        final_name: 'renamed.txt',
        kind: 'file',
        size: 4,
        status: 'ready',
      }],
      summary: { total: 1, changed: 1, unchanged: 0, excluded: 0, blocked: 0 },
    }
    render(
      <AdvancedRenamePreviewPane
        preview={preview}
        loading={false}
        error=""
        excludedPaths={new Set()}
        manualOverrides={{}}
        disabled={false}
        onToggleExcluded={vi.fn()}
        onManualOverride={vi.fn()}
        onClearManualOverride={vi.fn()}
      />,
    )

    expect(screen.getByText('demo.txt')).toBeInTheDocument()
    expect(screen.getByDisplayValue('renamed.txt')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'files.advancedRename.preview.list' })).toHaveAttribute('tabindex', '0')
  })

  it('预览计划更新时保留当前滚动位置', () => {
    const firstPreview: AdvancedRenamePreview = {
      plan_hash: 'plan-before-edit',
      items: [{
        source_path: '/srv/demo.txt',
        original_name: 'demo.txt',
        final_name: 'demo.txt',
        kind: 'file',
        size: 4,
        status: 'unchanged',
      }],
      summary: { total: 1, changed: 0, unchanged: 1, excluded: 0, blocked: 0 },
    }
    const props = {
      loading: false,
      error: '',
      excludedPaths: new Set<string>(),
      manualOverrides: {},
      disabled: false,
      onToggleExcluded: vi.fn(),
      onManualOverride: vi.fn(),
      onClearManualOverride: vi.fn(),
    }
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo)
    const view = render(<AdvancedRenamePreviewPane {...props} preview={firstPreview} />)
    scrollTo.mockClear()

    view.rerender(<AdvancedRenamePreviewPane
      {...props}
      preview={{ ...firstPreview, plan_hash: 'plan-after-edit' }}
    />)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('缺失项目仍可排除且窄屏诊断入口保持键盘可聚焦', () => {
    const onToggleExcluded = vi.fn()
    const preview: AdvancedRenamePreview = {
      plan_hash: 'plan-missing',
      items: [{
        source_path: '/srv/missing.txt',
        original_name: 'missing.txt',
        final_name: 'missing.txt',
        kind: 'file',
        size: 0,
        status: 'missing',
        diagnostics: [{ code: 'SOURCE_MISSING', message: 'source no longer exists' }],
      }],
      summary: { total: 1, changed: 0, unchanged: 0, excluded: 0, blocked: 1 },
    }
    render(
      <AdvancedRenamePreviewPane
        preview={preview}
        loading={false}
        error=""
        excludedPaths={new Set()}
        manualOverrides={{}}
        disabled={false}
        onToggleExcluded={onToggleExcluded}
        onManualOverride={vi.fn()}
        onClearManualOverride={vi.fn()}
      />,
    )

    const include = screen.getByRole('checkbox', {
      name: 'files.advancedRename.preview.includeItem',
    })
    expect(include).not.toBeDisabled()
    fireEvent.click(include)
    expect(onToggleExcluded).toHaveBeenCalledWith('/srv/missing.txt')
    expect(screen.getByLabelText(
      'files.advancedRename.status.missing: source no longer exists',
    )).toHaveAttribute('tabindex', '0')
  })

  it('失败结果展示实际路径和逐项状态并可返回规则编辑', () => {
    const onContinueEditing = vi.fn()
    const result: AdvancedRenameExecutionResult = {
      plan_hash: 'plan-partial',
      items: [{
        source_path: '/srv/demo.txt',
        target_path: '/srv/release-demo.txt',
        status: 'uncertain',
        message: 'remote state could not be confirmed',
      }],
      summary: {
        total: 1,
        renamed: 0,
        unchanged: 0,
        excluded: 0,
        rolled_back: 0,
        failed: 0,
        uncertain: 1,
      },
      partial: true,
      uncertain: true,
    }

    render(
      <AdvancedRenameResultPane
        result={result}
        disabled={false}
        onContinueEditing={onContinueEditing}
      />,
    )

    expect(screen.getByText('/srv/demo.txt')).toBeInTheDocument()
    expect(screen.getByText('/srv/release-demo.txt')).toBeInTheDocument()
    expect(screen.getByText('files.advancedRename.result.status.uncertain')).toBeInTheDocument()
    expect(screen.getByText('remote state could not be confirmed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'files.advancedRename.result.continueEditing',
    }))
    expect(onContinueEditing).toHaveBeenCalledTimes(1)
  })

  it('兼容旧 Core 在早期失败结果中返回 null items', () => {
    const result = {
      plan_hash: 'plan-legacy',
      items: null,
      summary: {
        total: 0,
        renamed: 0,
        unchanged: 0,
        excluded: 0,
        rolled_back: 0,
        failed: 0,
        uncertain: 0,
      },
      partial: false,
      uncertain: false,
    } as unknown as AdvancedRenameExecutionResult

    render(
      <AdvancedRenameResultPane
        result={result}
        disabled={false}
        onContinueEditing={vi.fn()}
      />,
    )

    expect(screen.getByRole('list', {
      name: 'files.advancedRename.result.list',
    })).toBeInTheDocument()
  })
})
