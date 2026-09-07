import assert from 'node:assert/strict'
import test from 'node:test'
import type { AdvancedRenamePreviewItem, FileRenamePreset } from '#entities/file'
import {
  advancedRenamePresetFingerprint,
  advancedRenameRuleChoice,
  advancedRenameRuleChoices,
  advancedRenameRuleDiagnostics,
  advancedRenameRuleKinds,
  advancedRenameVariableDefinitionErrors,
  advancedRenameVariableToken,
  advancedRenameVirtualWindow,
  buildAdvancedRenamePlanInput,
  createAdvancedRenameRule,
  duplicateAdvancedRenameRule,
  fileRenamePresetInput,
  filterAdvancedRenamePreviewItems,
  isAdvancedRenameSourceSessionCurrent,
  isAdvancedRenameVariableName,
  missingRequiredAdvancedRenameVariables,
  moveAdvancedRenameRule,
  presetFingerprint,
  resolveAdvancedRenameVariables,
  validateAdvancedRenameSource,
} from './advancedRenameModel.ts'

test('八类高级重命名规则都生成可执行的独立默认结构', () => {
  const rules = advancedRenameRuleKinds.map(createAdvancedRenameRule)

  assert.deepEqual(rules.map((rule) => rule.kind), advancedRenameRuleKinds)
  assert.equal(new Set(rules.map((rule) => rule.id)).size, advancedRenameRuleKinds.length)
  assert.ok(rules.every((rule) => rule.enabled))
  assert.equal(rules.find((rule) => rule.kind === 'template')?.config.template, '{{file.original}}')
  assert.equal(rules.find((rule) => rule.kind === 'replace')?.config.target, 'stem')
  assert.equal(rules.find((rule) => rule.kind === 'sequence')?.config.width, 3)
})

test('显式正则入口复用替换规则合同并保持预设向后兼容', () => {
  const regexRule = createAdvancedRenameRule('regex')
  const literalRule = createAdvancedRenameRule('replace')

  assert.ok(advancedRenameRuleChoices.includes('regex'))
  assert.equal(regexRule.kind, 'replace')
  assert.equal(regexRule.config.regex, true)
  assert.equal(advancedRenameRuleChoice(regexRule), 'regex')
  assert.equal(advancedRenameRuleChoice(literalRule), 'replace')
})

test('规则移动保留内容，复制规则生成新标识且不共享配置对象', () => {
  const first = createAdvancedRenameRule('template')
  const second = createAdvancedRenameRule('replace')
  const rules = [first, second]
  const moved = moveAdvancedRenameRule(rules, second.id, 0)
  const duplicate = duplicateAdvancedRenameRule(second)

  assert.deepEqual(moved.map((rule) => rule.id), [second.id, first.id])
  assert.notEqual(duplicate.id, second.id)
  assert.deepEqual(duplicate.config, second.config)
  assert.notEqual(duplicate.config, second.config)
  assert.equal(moveAdvancedRenameRule(rules, first.id, 0), rules)
  assert.equal(moveAdvancedRenameRule(rules, first.id, -1), rules)
})

test('高级重命名入口限制特殊项和超大选择，但允许文件夹与符号链接', () => {
  const entry = (kind: 'file' | 'directory' | 'symlink' | 'other') => ({
    name: `${kind}.txt`,
    path: `/srv/${kind}.txt`,
    kind,
    size: 1,
    is_hidden: false,
  })
  assert.deepEqual(validateAdvancedRenameSource([]), { valid: false, reason: 'empty' })
  assert.deepEqual(validateAdvancedRenameSource([entry('file'), entry('directory'), entry('symlink')]), { valid: true })
  assert.deepEqual(validateAdvancedRenameSource([entry('other')]), { valid: false, reason: 'unsupported' })
  assert.deepEqual(validateAdvancedRenameSource(Array.from({ length: 501 }, (_, index) => entry(`file-${index}` as 'file'))), { valid: false, reason: 'too_many' })
})

test('高级重命名来源仅在原文件会话保持连接且代际未变化时有效', () => {
  const source = { fileSessionId: 'fs-1', connectionGeneration: 3 }
  const session = {
    id: 'fs-1',
    status: 'connected' as const,
    connection_generation: 3,
  }

  assert.equal(isAdvancedRenameSourceSessionCurrent(source, session), true)
  assert.equal(isAdvancedRenameSourceSessionCurrent(source, { ...session, status: 'disconnected' }), false)
  assert.equal(isAdvancedRenameSourceSessionCurrent(source, { ...session, connection_generation: 4 }), false)
  assert.equal(isAdvancedRenameSourceSessionCurrent(source, { ...session, id: 'fs-2' }), false)
  assert.equal(isAdvancedRenameSourceSessionCurrent(source, session, true), false)
  assert.equal(isAdvancedRenameSourceSessionCurrent(source, null), false)
})

test('计划输入保留选择顺序并只投影来源范围内的排除和手工覆盖', () => {
  const rules = [createAdvancedRenameRule('sequence')]
  const input = buildAdvancedRenamePlanInput({
    connectionGeneration: 7,
    directory: '/srv/inbox',
    sourcePaths: ['/srv/inbox/b.txt', '/srv/inbox/a.txt'],
    excludedPaths: new Set(['/srv/inbox/a.txt', '/outside.txt']),
    rules,
    variables: { release: '2026.08' },
    order: { by: 'selection', direction: 'asc' },
    manualOverrides: {
      '/srv/inbox/b.txt': 'release-b.txt',
      '/outside.txt': 'ignored.txt',
    },
  })

  assert.deepEqual(input.source_paths, ['/srv/inbox/b.txt', '/srv/inbox/a.txt'])
  assert.deepEqual(input.excluded_paths, ['/srv/inbox/a.txt'])
  assert.deepEqual(input.manual_overrides, { '/srv/inbox/b.txt': 'release-b.txt' })
  assert.notEqual(input.rules[0], rules[0])
  assert.equal(input.expected_connection_generation, 7)
})

test('预设指纹只比较可复用规则内容并与服务端预设一致', () => {
  const rules = [createAdvancedRenameRule('cleanup')]
  const reusable = {
    rules,
    order: { by: 'name' as const, direction: 'asc' as const },
    variableDefinitions: [{
      name: 'release',
      label: '版本',
      description: '',
      default_value: '2026.08',
      required: true,
    }],
  }
  const preset: FileRenamePreset = {
    id: 'preset-1',
    name: '发布文件',
    description: '测试',
    rules,
    order: reusable.order,
    variable_definitions: reusable.variableDefinitions,
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
  }

  assert.equal(advancedRenamePresetFingerprint(reusable), presetFingerprint(preset))
  assert.equal(advancedRenameVariableToken('release'), '{{vars.release}}')
  assert.equal(isAdvancedRenameVariableName('release_2'), true)
  assert.equal(isAdvancedRenameVariableName('2release'), false)

  const input = fileRenamePresetInput({
    name: '  发布文件  ',
    description: '  测试  ',
    ...reusable,
  })
  assert.deepEqual(input.variable_definitions, reusable.variableDefinitions)
  assert.equal(input.name, '发布文件')
  assert.equal('variables' in input, false)
  assert.equal('manual_overrides' in input, false)
})

test('变量默认值只在没有本次覆盖时生效，必填变量按解析后的值校验', () => {
  const definitions = [{
    name: 'release', label: '版本', description: '发布版本', default_value: '2026.08', required: true,
  }, {
    name: 'channel', label: '渠道', description: '', default_value: '', required: true,
  }]
  assert.deepEqual(resolveAdvancedRenameVariables(definitions, {}), { release: '2026.08', channel: '' })
  assert.deepEqual(resolveAdvancedRenameVariables(definitions, { release: '2026.09' }), { release: '2026.09', channel: '' })
  assert.deepEqual(missingRequiredAdvancedRenameVariables(definitions, { release: '2026.09', channel: '' }).map((item) => item.name), ['channel'])
})

test('变量定义校验统一识别非法名称和重复名称', () => {
  const definition = (name: string) => ({
    name, label: name, description: '', default_value: '', required: false,
  })
  assert.deepEqual(advancedRenameVariableDefinitionErrors([
    definition('release'),
    definition('2invalid'),
    definition('release'),
    definition('channel'),
  ]), ['duplicate', 'invalid', 'duplicate', null])
})

test('预览筛选同时匹配状态、原名称、最终名称和来源路径', () => {
  const items: AdvancedRenamePreviewItem[] = [
    previewItem('/srv/inbox/旧名称.txt', '旧名称.txt', 'release.txt', 'ready'),
    previewItem('/srv/inbox/config.json', 'config.json', 'config.json', 'unchanged'),
    previewItem('/srv/inbox/bad.json', 'bad.json', 'bad.json', 'invalid'),
    previewItem('/srv/inbox/conflict.json', 'conflict.json', 'conflict.json', 'conflict'),
  ]

  assert.deepEqual(filterAdvancedRenamePreviewItems(items, 'ready', ''), [items[0]])
  assert.deepEqual(filterAdvancedRenamePreviewItems(items, 'changed', ''), [items[0]])
  assert.deepEqual(filterAdvancedRenamePreviewItems(items, 'issues', ''), [items[2], items[3]])
  assert.deepEqual(filterAdvancedRenamePreviewItems(items, 'all', 'RELEASE'), [items[0]])
  assert.deepEqual(filterAdvancedRenamePreviewItems(items, 'all', 'inbox/config'), [items[1]])
})

test('规则诊断按 rule_id 聚合并去重，缺少诊断字段时保持为空', () => {
  const items: AdvancedRenamePreviewItem[] = [
    {
      ...previewItem('/srv/a.txt', 'a.txt', 'a.txt', 'invalid'),
      diagnostics: [
        { code: 'REGEX_INVALID', message: '正则表达式无效', rule_id: 'rule-1' },
        { code: 'REGEX_INVALID', message: '正则表达式无效', rule_id: 'rule-1' },
        { code: 'OTHER', message: '另一条错误', rule_id: 'rule-2' },
      ],
    },
    { ...previewItem('/srv/b.txt', 'b.txt', 'b.txt', 'ready'), diagnostics: undefined },
  ]
  assert.deepEqual(advancedRenameRuleDiagnostics({ plan_hash: 'p', items, summary: {
    total: 2, changed: 0, unchanged: 1, excluded: 0, blocked: 1,
  } }), {
    'rule-1': ['正则表达式无效'],
    'rule-2': ['另一条错误'],
  })
  assert.deepEqual(advancedRenameRuleDiagnostics(null), {})
})

test('固定行高虚拟窗口包含可视范围与缓冲且不越过列表边界', () => {
  assert.deepEqual(advancedRenameVirtualWindow(1_000, 380, 380, 38, 2), {
    start: 8,
    end: 22,
    offset: 304,
    totalHeight: 38_000,
  })
  assert.deepEqual(advancedRenameVirtualWindow(3, 999, 0, 38, 5), {
    start: 0,
    end: 3,
    offset: 0,
    totalHeight: 114,
  })
})

function previewItem(
  sourcePath: string,
  originalName: string,
  finalName: string,
  status: AdvancedRenamePreviewItem['status'],
): AdvancedRenamePreviewItem {
  return {
    source_path: sourcePath,
    original_name: originalName,
    final_name: finalName,
    kind: 'file',
    size: 1,
    status,
    diagnostics: [],
  }
}
