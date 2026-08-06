import assert from 'node:assert/strict'
import test from 'node:test'
import type { CodeSnippet, CodeSnippetInput } from './types.ts'
import {
  analyzeSnippetRisk,
  extractSnippetVariables,
  normalizeSnippetInput,
  normalizeSnippetTags,
  renderSnippetCommand,
  snippetToInput,
} from './snippetUtils.ts'

test('命令片段输入规范化保留现有合同', () => {
  const input: CodeSnippetInput = {
    group_id: ' group-1 ',
    name: ' Deploy API ',
    description: ' production rollout ',
    command: ' echo ready ',
    tags: [' Production ', 'production', ' East   China '],
    shell: 'bash',
    favorite: true,
  }

  assert.deepEqual(normalizeSnippetInput(input), {
    group_id: 'group-1',
    name: 'Deploy API',
    description: 'production rollout',
    command: 'echo ready',
    tags: ['East China', 'Production'],
    shell: 'bash',
    favorite: true,
  })
  assert.deepEqual(normalizeSnippetTags([' Prod ', 'prod', '', ' Web   API ']), ['Prod', 'Web API'])
})

test('命令片段快照转换补齐可编辑字段默认值', () => {
  const snippet: CodeSnippet = {
    id: 'snippet-1',
    group_id: '',
    name: 'Inspect',
    command: 'uptime',
    tags: [],
    shell: 'any',
    favorite: false,
    use_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  assert.deepEqual(snippetToInput(snippet), {
    group_id: '',
    name: 'Inspect',
    description: '',
    command: 'uptime',
    tags: [],
    shell: 'any',
    favorite: false,
  })
})

test('变量提取、替换和风险识别保持发送前语义', () => {
  const command = 'tail -n {{ lines }} "{{file}}" && echo {{lines}}'

  assert.deepEqual(extractSnippetVariables(command), ['lines', 'file'])
  assert.equal(renderSnippetCommand(command, { lines: '20', file: '/var/log/app.log' }), 'tail -n 20 "/var/log/app.log" && echo 20')
  assert.equal(renderSnippetCommand('echo {{value}}', { value: '$&' }), 'echo $&')
  assert.deepEqual(analyzeSnippetRisk('echo ready'), { risky: false, reasons: [] })
  assert.deepEqual(analyzeSnippetRisk('systemctl restart nginx && rm -rf /tmp/cache'), {
    risky: true,
    reasons: ['recursiveDelete', 'serviceControl'],
  })
})
