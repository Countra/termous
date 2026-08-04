import {
  normalizeKeyboardEventToChord,
  shortcutChordSignature,
} from './chords.ts'
import { getShortcutAction } from './registry.ts'
import type {
  ShortcutActionId,
  ShortcutChord,
  ShortcutIndex,
  ShortcutKeyboardEventLike,
  ShortcutScope,
} from './types.ts'

export type ShortcutHandlerResult = 'handled' | 'fallthrough' | 'blocked'

export type ShortcutContextLayer =
  | 'global'
  | 'page'
  | 'focus'
  | 'transient'

export type ShortcutDispatchReason =
  | 'handled'
  | 'blocked'
  | 'no_match'
  | 'no_handler'
  | 'ambiguous'
  | 'recorder'
  | 'guarded'
  | 'handler_error'

export interface ShortcutDispatchResult {
  readonly result: ShortcutHandlerResult
  readonly reason: ShortcutDispatchReason
  readonly actionId?: ShortcutActionId
  readonly ambiguousActionIds?: readonly ShortcutActionId[]
}

export interface ShortcutDispatchOptions {
  readonly editable?: boolean
  readonly adapterId?: string
  readonly contextIds?: Iterable<string>
  readonly handlerContextIds?: Iterable<string>
}

export interface ShortcutHandlerContext {
  readonly actionId: ShortcutActionId
  readonly chord: ShortcutChord
  readonly contextId: string
  readonly adapterId?: string
}

export type ShortcutHandler = (
  event: ShortcutKeyboardEventLike,
  context: ShortcutHandlerContext,
) => ShortcutHandlerResult

export interface ShortcutContextDefinition {
  readonly id: string
  readonly layer: ShortcutContextLayer
  readonly scopes: readonly ShortcutScope[] | (() => Iterable<ShortcutScope>)
  readonly priority?: number
  readonly isActive?: () => boolean
}

export interface ShortcutRecorderContext {
  readonly id: string
  readonly capture: (
    event: ShortcutKeyboardEventLike,
    chord: ShortcutChord,
  ) => Exclude<ShortcutHandlerResult, 'fallthrough'>
}

export interface ShortcutRuntimeOptions {
  readonly index: ShortcutIndex
  readonly onHandlerError?: (
    error: unknown,
    actionId: ShortcutActionId | null,
    contextId: string,
  ) => void
}

interface ShortcutContextEntry {
  readonly definition: ShortcutContextDefinition
  readonly order: number
  readonly handlers: Map<ShortcutActionId, ShortcutHandler>
}

interface ShortcutRecorderEntry {
  readonly definition: ShortcutRecorderContext
  readonly order: number
}

interface ActiveShortcutContext {
  readonly id: string
  readonly scopes: ReadonlySet<ShortcutScope>
  readonly handlers: ReadonlyMap<ShortcutActionId, ShortcutHandler>
  readonly order: number
  readonly layerPriority: number
  readonly priority: number
}

const contextLayerPriority: Readonly<Record<ShortcutContextLayer, number>> = {
  global: 100,
  page: 200,
  focus: 300,
  transient: 400,
}

const fallthroughResult: ShortcutDispatchResult = Object.freeze({
  result: 'fallthrough',
  reason: 'no_match',
})

/**
 * 管理应用窗口内的快捷键解析。运行时只读取预编译索引和本地 Map，
 * 不持有 React 状态，也不会自行阻止浏览器或终端的默认行为。
 */
export class ShortcutRuntime {
  private index: ShortcutIndex
  private readonly contexts = new Map<string, ShortcutContextEntry>()
  private readonly recorders = new Map<string, ShortcutRecorderEntry>()
  private readonly nonRepeatKeyLatches = new Set<string>()
  private readonly onHandlerError?: ShortcutRuntimeOptions['onHandlerError']
  private order = 0

  constructor(options: ShortcutRuntimeOptions) {
    this.index = options.index
    this.onHandlerError = options.onHandlerError
  }

  updateIndex(index: ShortcutIndex) {
    this.index = index
  }

  pushContext(definition: ShortcutContextDefinition) {
    if (!definition.id.trim()) {
      throw new TypeError('Shortcut context id is required')
    }
    if (this.contexts.has(definition.id)) {
      throw new Error(`Shortcut context already exists: ${definition.id}`)
    }

    const entry: ShortcutContextEntry = {
      definition,
      order: ++this.order,
      handlers: new Map(),
    }
    this.contexts.set(definition.id, entry)
    return createIdempotentDisposer(() => {
      if (this.contexts.get(definition.id) === entry) {
        this.contexts.delete(definition.id)
      }
    })
  }

  registerHandler(
    contextId: string,
    actionId: ShortcutActionId,
    handler: ShortcutHandler,
  ) {
    const context = this.contexts.get(contextId)
    if (!context) {
      throw new Error(`Shortcut context does not exist: ${contextId}`)
    }
    getShortcutAction(actionId)
    if (context.handlers.has(actionId)) {
      throw new Error(`Shortcut handler already exists: ${contextId}/${actionId}`)
    }

    context.handlers.set(actionId, handler)
    return createIdempotentDisposer(() => {
      if (context.handlers.get(actionId) === handler) {
        context.handlers.delete(actionId)
      }
    })
  }

  /**
   * 录制器独立于业务动作索引。最新打开的录制器优先，并阻止同一按键触发真实业务。
   */
  pushRecorder(definition: ShortcutRecorderContext) {
    if (!definition.id.trim()) {
      throw new TypeError('Shortcut recorder id is required')
    }
    if (this.recorders.has(definition.id)) {
      throw new Error(`Shortcut recorder already exists: ${definition.id}`)
    }
    const entry: ShortcutRecorderEntry = {
      definition,
      order: ++this.order,
    }
    this.recorders.set(definition.id, entry)
    return createIdempotentDisposer(() => {
      if (this.recorders.get(definition.id) === entry) {
        this.recorders.delete(definition.id)
      }
    })
  }

  dispatch(
    event: ShortcutKeyboardEventLike,
    options: ShortcutDispatchOptions = {},
  ): ShortcutDispatchResult {
    if (event.type === 'keyup') {
      this.releaseKey(event.code)
      return fallthroughResult
    }
    const latchKey = shortcutLatchKey(options.adapterId, event.code)
    if (event.repeat && this.nonRepeatKeyLatches.has(latchKey)) {
      return { result: 'blocked', reason: 'guarded' }
    }
    const chord = normalizeKeyboardEventToChord(event)
    if (!chord) return fallthroughResult

    const recorder = this.getActiveRecorder()
    if (recorder) {
      try {
        return {
          result: recorder.definition.capture(event, chord),
          reason: 'recorder',
        }
      } catch (error) {
        this.onHandlerError?.(error, null, recorder.definition.id)
        return { result: 'blocked', reason: 'handler_error' }
      }
    }

    const entries = this.index.byChord.get(
      shortcutChordSignature(chord, this.index.platform),
    )
    if (!entries?.length) return fallthroughResult

    const contexts = this.getActiveContexts(options.contextIds)
    const contextEligible = entries.filter((entry) => {
      const definition = getShortcutAction(entry.actionId)
      if (options.editable && !definition.allowInEditable) return false
      return contexts.some((context) => context.scopes.has(entry.scope))
    })
    if (!contextEligible.length) {
      return { result: 'fallthrough', reason: 'guarded' }
    }

    const actionIds = [...new Set(contextEligible.map((entry) => entry.actionId))]
    if (actionIds.length > 1) {
      this.latchKey(event, options.adapterId)
      return {
        result: 'blocked',
        reason: 'ambiguous',
        ambiguousActionIds: actionIds,
      }
    }
    const eligible = contextEligible.filter((entry) => (
      !event.repeat || getShortcutAction(entry.actionId).allowRepeat
    ))
    if (!eligible.length) {
      return { result: 'fallthrough', reason: 'guarded' }
    }

    const actionId = actionIds[0]
    if (!actionId) return fallthroughResult
    const handlerContextIds = options.handlerContextIds
      ? new Set(options.handlerContextIds)
      : null
    let handlerInvoked = false
    for (const context of contexts) {
      if (handlerContextIds && !handlerContextIds.has(context.id)) continue
      if (!eligible.some((entry) => context.scopes.has(entry.scope))) continue
      const handler = context.handlers.get(actionId)
      if (!handler) continue

      let result: ShortcutHandlerResult
      try {
        handlerInvoked = true
        result = handler(event, {
          actionId,
          chord,
          contextId: context.id,
          adapterId: options.adapterId,
        })
      } catch (error) {
        this.onHandlerError?.(error, actionId, context.id)
        return { result: 'blocked', reason: 'handler_error', actionId }
      }
      if (result === 'handled') {
        const dispatchResult = { result, reason: 'handled', actionId } as const
        this.latchNonRepeatKey(event, options.adapterId, dispatchResult)
        return dispatchResult
      }
      if (result === 'blocked') {
        const dispatchResult = { result, reason: 'blocked', actionId } as const
        this.latchNonRepeatKey(event, options.adapterId, dispatchResult)
        return dispatchResult
      }
    }
    const dispatchResult = { result: 'fallthrough', reason: 'no_handler', actionId } as const
    if (handlerInvoked) {
      this.latchNonRepeatKey(event, options.adapterId, dispatchResult)
    }
    return dispatchResult
  }

  releaseKey(code: string) {
    if (!code) return
    const suffix = `\u0000${code}`
    for (const key of this.nonRepeatKeyLatches) {
      if (key.endsWith(suffix)) {
        this.nonRepeatKeyLatches.delete(key)
      }
    }
  }

  releaseAllKeys() {
    this.nonRepeatKeyLatches.clear()
  }

  private latchNonRepeatKey(
    event: ShortcutKeyboardEventLike,
    adapterId: string | undefined,
    result: ShortcutDispatchResult,
  ) {
    if (event.repeat || !result.actionId) return
    if (getShortcutAction(result.actionId).allowRepeat) return
    this.latchKey(event, adapterId)
  }

  private latchKey(event: ShortcutKeyboardEventLike, adapterId: string | undefined) {
    if (event.repeat) return
    this.nonRepeatKeyLatches.add(shortcutLatchKey(adapterId, event.code))
  }

  private getActiveRecorder() {
    let active: ShortcutRecorderEntry | undefined
    for (const recorder of this.recorders.values()) {
      if (!active || recorder.order > active.order) active = recorder
    }
    return active
  }

  private getActiveContexts(contextIds?: Iterable<string>): readonly ActiveShortcutContext[] {
    const allowedContextIds = contextIds ? new Set(contextIds) : null
    const active: ActiveShortcutContext[] = []
    for (const context of this.contexts.values()) {
      if (allowedContextIds && !allowedContextIds.has(context.definition.id)) continue
      if (context.definition.isActive && !context.definition.isActive()) continue
      const scopes = resolveContextScopes(context.definition.scopes)
      if (!scopes.size) continue
      active.push({
        id: context.definition.id,
        scopes,
        handlers: context.handlers,
        order: context.order,
        layerPriority: contextLayerPriority[context.definition.layer],
        priority: context.definition.priority ?? 0,
      })
    }
    return active.sort((first, second) => (
      second.layerPriority - first.layerPriority
      || second.priority - first.priority
      || second.order - first.order
    ))
  }
}

export function shouldPreventShortcutDefault(result: ShortcutDispatchResult) {
  return result.result === 'handled' || result.result === 'blocked'
}

export function applyShortcutDispatchResult(
  event: Pick<Event, 'preventDefault' | 'stopPropagation'>,
  result: ShortcutDispatchResult,
  stopPropagation = false,
) {
  if (!shouldPreventShortcutDefault(result)) return false
  event.preventDefault()
  if (stopPropagation) event.stopPropagation()
  return true
}

function resolveContextScopes(
  source: ShortcutContextDefinition['scopes'],
): ReadonlySet<ShortcutScope> {
  const values = typeof source === 'function' ? source() : source
  return new Set(values)
}

function createIdempotentDisposer(dispose: () => void) {
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    dispose()
  }
}

function shortcutLatchKey(adapterId: string | undefined, code: string) {
  return `${adapterId ?? ''}\u0000${code}`
}
