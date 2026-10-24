import assert from 'node:assert/strict'
import test from 'node:test'
import { Compile } from 'typebox/compile'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import { PreparationStopped } from './contracts.ts'
import { validateArguments } from './validation.ts'

test('参数错误明确定位业务字段且不回显无关正文', () => {
  const schema = Compile({ type: 'object', properties: { x: { type: 'integer' }, text: { type: 'string' }, screenshot_id: { type: 'string' } }, required: ['x', 'screenshot_id'], additionalProperties: false })
  assert.throws(() => validateArguments(schema, { x: 'private-value', text: 'private-command' }, 'Invalid fields'), (error: unknown) => {
    assert.ok(error instanceof PreparationStopped)
    assert.ok(isMCPToolDetails(error.result.details))
    const output = error.result.details.result.structuredContent as { error: { execution: { parameter_errors: { path: string; rule: string }[] } } }
    const issues = output.error.execution.parameter_errors
    assert.ok(issues.some((issue) => issue.path === '/x' && issue.rule === 'type'))
    assert.ok(issues.some((issue) => issue.path === '/screenshot_id' && issue.rule === 'required'))
    assert.ok(!JSON.stringify(output).includes('private-'))
    return true
  })
})

test('参数恢复明细最多保留八项，正确请求直接通过', () => {
  const schema = Compile({ type: 'object', required: Array.from({ length: 20 }, (_, i) => `field_${i}`) })
  assert.throws(() => validateArguments(schema, {}, 'Invalid fields'), (error: unknown) => {
    assert.ok(error instanceof PreparationStopped)
    assert.ok(isMCPToolDetails(error.result.details))
    const output = error.result.details.result.structuredContent as { error: { execution: { parameter_errors: unknown[] } } }
    assert.equal(output.error.execution.parameter_errors.length, 8)
    return true
  })
  validateArguments(Compile({ type: 'object' }), {}, 'Invalid fields')
})
