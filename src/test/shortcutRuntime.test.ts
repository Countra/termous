import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyShortcutDispatchResult,
  ShortcutRuntime,
  shouldPreventShortcutDefault,
  type ShortcutHandlerResult,
} from '../features/shortcuts/runtime.ts'
import {
  compileShortcutIndex,
  createShortcutChord,
  setShortcutBindingOverride,
} from '../features/shortcuts/index.ts'
import type {
  ShortcutActionId,
  ShortcutKeyboardEventLike,
  ShortcutScope,
} from '../features/shortcuts/index.ts'

function keyboardEvent(
  code: string,
  key: string,
  values: Partial<ShortcutKeyboardEventLike> = {},
): ShortcutKeyboardEventLike {
  return { type: 'keydown', code, key, ...values }
}

function installContext(
  runtime: ShortcutRuntime,
  values: {
    id: string
    scopes: readonly ShortcutScope[] | (() => Iterable<ShortcutScope>)
    layer?: 'global' | 'page' | 'focus' | 'transient'
    priority?: number
    handlers: Partial<Record<ShortcutActionId, () => ShortcutHandlerResult>>
  },
) {
  const disposeContext = runtime.pushContext({
    id: values.id,
    layer: values.layer ?? 'focus',
    scopes: values.scopes,
    priority: values.priority,
  })
  const disposeHandlers = Object.entries(values.handlers).map(([actionId, handler]) => (
    runtime.registerHandler(
      values.id,
      actionId as ShortcutActionId,
      handler as () => ShortcutHandlerResult,
    )
  ))
  return () => {
    disposeHandlers.forEach((dispose) => dispose())
    disposeContext()
  }
}

test('上下文按瞬态、焦点、页面和全局优先级依次执行', () => {
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  const calls: string[] = []
  installContext(runtime, {
    id: 'page',
    layer: 'page',
    priority: 10_000,
    scopes: ['terminal.completion.visible'],
    handlers: {
      'terminal.completion.accept': () => {
        calls.push('page')
        return 'handled'
      },
    },
  })
  installContext(runtime, {
    id: 'transient',
    layer: 'transient',
    scopes: ['terminal.completion.visible'],
    handlers: {
      'terminal.completion.accept': () => {
        calls.push('transient')
        return 'fallthrough'
      },
    },
  })

  const result = runtime.dispatch(keyboardEvent('Enter', 'Enter'))
  assert.deepEqual(calls, ['transient', 'page'])
  assert.deepEqual(result, {
    result: 'handled',
    reason: 'handled',
    actionId: 'terminal.completion.accept',
  })
})

test('blocked 立即终止责任链，只有 handled 和 blocked 阻止默认行为', () => {
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  let lowerCalled = false
  installContext(runtime, {
    id: 'lower',
    layer: 'page',
    scopes: ['terminal.completion.visible'],
    handlers: {
      'terminal.completion.accept': () => {
        lowerCalled = true
        return 'handled'
      },
    },
  })
  installContext(runtime, {
    id: 'upper',
    layer: 'transient',
    scopes: ['terminal.completion.visible'],
    handlers: { 'terminal.completion.accept': () => 'blocked' },
  })

  const blocked = runtime.dispatch(keyboardEvent('Enter', 'Enter'))
  assert.equal(blocked.result, 'blocked')
  assert.equal(lowerCalled, false)
  assert.equal(shouldPreventShortcutDefault(blocked), true)
  assert.equal(
    shouldPreventShortcutDefault({ result: 'fallthrough', reason: 'no_match' }),
    false,
  )

  const calls: string[] = []
  const event = {
    preventDefault: () => calls.push('prevent'),
    stopPropagation: () => calls.push('stop'),
  }
  assert.equal(applyShortcutDispatchResult(event, blocked, true), true)
  assert.deepEqual(calls, ['prevent', 'stop'])
})

test('录制器优先捕获按键并阻止真实业务动作', () => {
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  let businessCalls = 0
  installContext(runtime, {
    id: 'completion',
    scopes: ['terminal.completion.visible'],
    handlers: {
      'terminal.completion.accept': () => {
        businessCalls += 1
        return 'handled'
      },
    },
  })
  const captured: string[] = []
  const disposeFirst = runtime.pushRecorder({
    id: 'first',
    capture: (_event, chord) => {
      captured.push(`first:${chord.code}`)
      return 'handled'
    },
  })
  const disposeSecond = runtime.pushRecorder({
    id: 'second',
    capture: (_event, chord) => {
      captured.push(`second:${chord.code}`)
      return 'blocked'
    },
  })

  assert.equal(runtime.dispatch(keyboardEvent('Enter', 'Enter')).reason, 'recorder')
  assert.deepEqual(captured, ['second:Enter'])
  assert.equal(businessCalls, 0)
  disposeSecond()
  assert.equal(runtime.dispatch(keyboardEvent('Enter', 'Enter')).reason, 'recorder')
  assert.deepEqual(captured, ['second:Enter', 'first:Enter'])
  disposeFirst()
  assert.equal(runtime.dispatch(keyboardEvent('Enter', 'Enter')).reason, 'handled')
  assert.equal(businessCalls, 1)
})

test('IME、可编辑区域和按键重复受到动作定义保护', () => {
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  const calls: string[] = []
  installContext(runtime, {
    id: 'terminal',
    scopes: ['terminal.completion.visible'],
    handlers: {
      'terminal.completion.accept': () => {
        calls.push('accept')
        return 'handled'
      },
      'terminal.completion.next': () => {
        calls.push('next')
        return 'handled'
      },
    },
  })

  assert.equal(
    runtime.dispatch(keyboardEvent('Enter', 'Enter', { isComposing: true })).result,
    'fallthrough',
  )
  assert.equal(
    runtime.dispatch(keyboardEvent('Enter', 'Enter'), { editable: true }).reason,
    'guarded',
  )
  assert.equal(
    runtime.dispatch(keyboardEvent('Enter', 'Enter', { repeat: true })).reason,
    'guarded',
  )
  assert.equal(
    runtime.dispatch(keyboardEvent('ArrowDown', 'ArrowDown', { repeat: true })).result,
    'handled',
  )
  assert.deepEqual(calls, ['next'])
})

test('运行时禁用当前上下文中的歧义绑定，不任意选择动作', () => {
  const override = setShortcutBindingOverride(
    setShortcutBindingOverride(
      {},
      'terminal.completion.accept',
      [createShortcutChord('F6', 'F6')],
    ),
    'terminal.search.open',
    [createShortcutChord('F6', 'F6')],
  )
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex(override, 'win32'),
  })
  const calls: string[] = []
  installContext(runtime, {
    id: 'terminal',
    scopes: ['terminal.completion.visible', 'terminal.active'],
    handlers: {
      'terminal.completion.accept': () => {
        calls.push('accept')
        return 'handled'
      },
      'terminal.search.open': () => {
        calls.push('search')
        return 'handled'
      },
    },
  })

  const result = runtime.dispatch(keyboardEvent('F6', 'F6'))
  assert.equal(result.result, 'blocked')
  assert.equal(result.reason, 'ambiguous')
  assert.deepEqual(result.ambiguousActionIds, [
    'terminal.completion.accept',
    'terminal.search.open',
  ])
  assert.equal(
    runtime.dispatch(keyboardEvent('F6', 'F6', { repeat: true })).result,
    'blocked',
  )
  assert.deepEqual(calls, [])
})

test('互斥上下文可复用按键，动态 scope 只执行当前活动动作', () => {
  let terminalActive = true
  const overrides = setShortcutBindingOverride(
    setShortcutBindingOverride(
      {},
      'terminal.search.open',
      [createShortcutChord('F6', 'F6')],
    ),
    'files.rename_focused',
    [createShortcutChord('F6', 'F6')],
  )
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex(overrides, 'win32'),
  })
  const calls: string[] = []
  installContext(runtime, {
    id: 'terminal',
    scopes: () => terminalActive ? ['terminal.active'] : [],
    handlers: {
      'terminal.search.open': () => {
        calls.push('terminal')
        return 'handled'
      },
    },
  })
  installContext(runtime, {
    id: 'files',
    scopes: () => terminalActive ? [] : ['files.standalone'],
    handlers: {
      'files.rename_focused': () => {
        calls.push('files')
        return 'handled'
      },
    },
  })

  assert.equal(runtime.dispatch(keyboardEvent('F6', 'F6')).actionId, 'terminal.search.open')
  terminalActive = false
  assert.equal(runtime.dispatch(keyboardEvent('F6', 'F6')).actionId, 'files.rename_focused')
  assert.deepEqual(calls, ['terminal', 'files'])
})

test('处理器异常转为 blocked 并上报，索引与注册均可安全更新', () => {
  const errors: unknown[] = []
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
    onHandlerError: (error) => errors.push(error),
  })
  const disposeContext = runtime.pushContext({
    id: 'global',
    layer: 'global',
    scopes: ['app.global'],
  })
  const disposeHandler = runtime.registerHandler(
    'global',
    'app.host_launcher.open',
    () => {
      throw new Error('boom')
    },
  )

  const event = keyboardEvent('KeyH', 'H', { ctrlKey: true, shiftKey: true })
  assert.equal(runtime.dispatch(event).reason, 'handler_error')
  assert.equal(errors.length, 1)
  runtime.updateIndex(compileShortcutIndex({
    'app.host_launcher.open': { bindings: [] },
  }, 'win32'))
  assert.equal(runtime.dispatch(event).reason, 'no_match')

  disposeHandler()
  disposeHandler()
  disposeContext()
  disposeContext()
  assert.throws(
    () => runtime.registerHandler('global', 'app.host_launcher.open', () => 'handled'),
    /does not exist/,
  )
})

test('适配器可限制解析上下文，窗口监听不会抢占终端动作', () => {
  const overrides = setShortcutBindingOverride(
    {},
    'terminal.search.open',
    [createShortcutChord('KeyH', 'H', ['control', 'shift'])],
  )
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex(overrides, 'win32'),
  })
  const calls: string[] = []
  installContext(runtime, {
    id: 'window',
    layer: 'global',
    scopes: ['app.global'],
    handlers: {
      'app.host_launcher.open': () => {
        calls.push('window')
        return 'handled'
      },
    },
  })
  installContext(runtime, {
    id: 'terminal',
    scopes: ['terminal.active'],
    handlers: {
      'terminal.search.open': () => {
        calls.push('terminal')
        return 'handled'
      },
    },
  })

  const event = keyboardEvent('KeyH', 'H', { ctrlKey: true, shiftKey: true })
  assert.equal(
    runtime.dispatch(event, { contextIds: ['window'] }).actionId,
    'app.host_launcher.open',
  )
  assert.deepEqual(calls, ['window'])
})

test('非重复动作在 keyup 前阻止长按穿透，允许补全上下键连续切换', () => {
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  let completionVisible = true
  installContext(runtime, {
    id: 'completion',
    scopes: () => completionVisible ? ['terminal.completion.visible'] : [],
    handlers: {
      'terminal.completion.accept': () => {
        completionVisible = false
        return 'fallthrough'
      },
      'terminal.completion.next': () => 'handled',
    },
  })

  const enter = keyboardEvent('Enter', 'Enter')
  assert.equal(runtime.dispatch(enter, { adapterId: 'xterm:test' }).result, 'fallthrough')
  assert.equal(
    runtime.dispatch(keyboardEvent('Enter', 'Enter', { repeat: true }), {
      adapterId: 'xterm:test',
    }).result,
    'blocked',
  )
  runtime.releaseKey('Enter')
  assert.equal(
    runtime.dispatch(keyboardEvent('Enter', 'Enter', { repeat: true }), {
      adapterId: 'xterm:test',
    }).result,
    'fallthrough',
  )

  completionVisible = true
  assert.equal(
    runtime.dispatch(keyboardEvent('ArrowDown', 'ArrowDown', { repeat: true }), {
      adapterId: 'xterm:test',
    }).result,
    'handled',
  )
})

test('缺少处理器的匹配动作不会吞掉后续按键重复', () => {
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  runtime.pushContext({
    id: 'global-without-handler',
    layer: 'global',
    scopes: ['app.global'],
  })
  const event = keyboardEvent('KeyH', 'H', { ctrlKey: true, shiftKey: true })
  assert.equal(runtime.dispatch(event, { adapterId: 'test' }).reason, 'no_handler')
  assert.equal(
    runtime.dispatch(keyboardEvent('KeyH', 'H', {
      ctrlKey: true,
      shiftKey: true,
      repeat: true,
    }), { adapterId: 'test' }).result,
    'fallthrough',
  )
})
