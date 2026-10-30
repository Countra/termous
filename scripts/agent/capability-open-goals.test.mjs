import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenGoal, openGoalCases } from './capability-open-goals.mjs'

test('开放目标接受单步和等效链式输入，记录长等待但不增加执行限制', () => {
  const click = { x: 20, y: 30, screenshot_id: 'fixture-shot' }
  assert.equal(createOpenGoal(openGoalCases[0]).apply('termous.desktops.pointer.click', click).completed, true)
  const batch = createOpenGoal(openGoalCases[0]).apply('termous.desktops.execute', { screenshot_id: click.screenshot_id, actions: [{ kind: 'pointer.click', x: 20, y: 30, wait_after_ms: 30000 }] })
  assert.equal(batch.completed, true)
  assert.equal(batch.fixed_delay_ms, 30000)
  assert.equal(createOpenGoal(openGoalCases[0]).apply('termous.desktops.pointer.click', { ...click, screenshot_id: 'other' }).valid, false)
  assert.equal(createOpenGoal(openGoalCases[0]).apply('termous.desktops.pointer.click', { ...click, count: 2 }).valid, false)
})

test('多步目标按实际参数和次序验收，不把第一个工具名当成完成', () => {
  const goal = createOpenGoal(openGoalCases[1])
  assert.equal(goal.apply('termous.desktops.keyboard.text', { text: 'termous' }).valid, false)
  assert.equal(goal.apply('termous.desktops.keyboard.shortcut', { codes: ['ControlLeft', 'KeyA'] }).completed, false)
  assert.equal(goal.apply('termous.desktops.keyboard.text', { text: 'termous' }).completed, true)
  const batch = createOpenGoal(openGoalCases[1]).apply('termous.desktops.execute', { actions: [
    { kind: 'keyboard.shortcut', codes: ['ControlLeft', 'KeyA'] }, { kind: 'keyboard.text', text: 'termous' },
  ] })
  assert.equal(batch.completed, true)
  assert.equal(batch.fixed_delay_ms, 1000)
})
