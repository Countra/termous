import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'
import { installDevelopmentReactTimingCleanup } from './developmentReactTiming.ts'

const original = globalThis.PerformanceObserver
afterEach(() => { globalThis.PerformanceObserver = original; mock.restoreAll() })

test('仅消费 React 开发测量，后台通知不累计组件属性差异，热更新时撤销观察', () => {
  let callback!: PerformanceObserverCallback
  const disconnect = mock.fn()
  const observe = mock.fn()
  const entries = (name: string, detail: unknown) => ({ name, entryType: 'measure', detail } as PerformanceMeasure)
  const pending = [entries('pending', { devtools: { trackGroup: 'Scheduler ⚛' } })]
  globalThis.PerformanceObserver = class {
    static supportedEntryTypes = ['measure']
    constructor(value: PerformanceObserverCallback) { callback = value }
    observe = observe
    disconnect = disconnect
    takeRecords() { return pending }
  } as unknown as typeof PerformanceObserver
  const clear = mock.method(performance, 'clearMeasures', () => undefined)
  const dispose = installDevelopmentReactTimingCleanup()
  assert.deepEqual(observe.mock.calls[0].arguments, [{ type: 'measure', buffered: true }])
  const batch = [entries('component', { devtools: { track: 'Components ⚛' } }),
    entries('component', { devtools: { track: 'Components ⚛' } }), entries('request', { bytes: 100 }),
    entries('other', { devtools: { track: 'Other' } }), entries('empty', null)]
  callback({ getEntries: () => batch } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver)
  assert.deepEqual(clear.mock.calls.map(call => call.arguments), [['component']])
  dispose()
  assert.deepEqual(clear.mock.calls.map(call => call.arguments), [['component'], ['pending']])
  assert.equal(disconnect.mock.calls.length, 1)
})

test('不支持 User Timing 观察时不修改性能接口', () => {
  globalThis.PerformanceObserver = undefined as unknown as typeof PerformanceObserver
  assert.doesNotThrow(() => installDevelopmentReactTimingCleanup()())
})
