// 开放目标验收允许不同调用路径；这里只检查合成动作与参数，不代表真实桌面操作成功。
export const openGoalCases = [
  { id: 'catalog_open_click', evaluation: 'open_goal', prompt: '当前目标桌面已观察并获准操作，截图 fixture-shot 中按钮中心为 (20, 30)。请单击一次并完成目标，可自行选择合适工具。', accepted: ['termous.desktops.pointer.click', 'termous.desktops.execute'] },
  { id: 'catalog_open_replace', evaluation: 'open_goal', prompt: '当前目标桌面的文本框已经聚焦且获准操作，ControlLeft+KeyA 可以全选。请把内容替换成 termous，可自行选择合适工具和步骤。', accepted: ['termous.desktops.keyboard.shortcut', 'termous.desktops.keyboard.text', 'termous.desktops.execute'] },
]

const actionProperties = { kind: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' },
  codes: { type: 'array', items: { type: 'string' } }, text: { type: 'string' }, button: { type: 'string' }, count: { type: 'integer' },
  wait_after_ms: { type: 'integer', minimum: 0, maximum: 90000 } }

export function openGoalSchema(name) {
  const properties = name === 'termous.desktops.execute'
    ? { screenshot_id: { type: 'string' }, interval_ms: { type: 'integer', minimum: 0, maximum: 90000 }, actions: { type: 'array', minItems: 1, maxItems: 5,
      items: { type: 'object', properties: actionProperties, required: ['kind'], additionalProperties: false } } }
    : { ...actionProperties, screenshot_id: { type: 'string' } }
  return { type: 'object', properties, additionalProperties: false }
}

export function createOpenGoal(task) {
  let position = 0
  const expected = task.id === 'catalog_open_click'
    ? [action => action.kind === 'pointer.click' && action.x === 20 && action.y === 30 && (action.button ?? 'left') === 'left' && (action.count ?? 1) === 1]
    : [action => action.kind === 'keyboard.shortcut' && JSON.stringify(action.codes) === '["ControlLeft","KeyA"]', action => action.kind === 'keyboard.text' && action.text === 'termous']
  return {
    apply(name, args) {
      const batch = name === 'termous.desktops.execute'
      const actions = batch ? args.actions : [{ ...args, kind: name.replace('termous.desktops.', '') }]
      const valid = task.accepted.includes(name) && Array.isArray(actions) && actions.length > 0 && actions.length <= 5
        && (task.id !== 'catalog_open_click' || args.screenshot_id === 'fixture-shot')
        && actions.every((action, index) => expected[position + index]?.(action))
      if (valid) position += actions.length
      const delay = batch && Array.isArray(actions) ? actions.reduce((sum, action) => sum + (action.wait_after_ms ?? args.interval_ms ?? 500), 0) : 0
      return { valid: Boolean(valid), completed: position === expected.length, fixed_delay_ms: delay }
    },
    success: () => position === expected.length,
  }
}
