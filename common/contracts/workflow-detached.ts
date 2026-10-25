import { isAnalysisMediaRequest, type AnalysisMediaRequest } from './analysis-media.ts'
import { isWorkflowOCRQuery, type WorkflowOCRQuery } from './workflow-ocr.ts'
import { isWorkflowEditorPanels } from './workflow-layout.ts'
import { analysisPanelLimits } from './screen-analysis-records.ts'

export const workflowDetachedActions = [
  'create', 'load', 'change', 'selectStep', 'target', 'view', 'showRun', 'save', 'validate',
  'history', 'closeHistory', 'restore', 'remove', 'copy', 'openRun', 'closeRun', 'changeRun',
  'start', 'control', 'refresh', 'refreshReport', 'viewDesktop', 'dismissNotice', 'presentation',
] as const
export type WorkflowDetachedAction = typeof workflowDetachedActions[number]
const noArgumentActions = new Set<WorkflowDetachedAction>([
  'save', 'validate', 'history', 'closeHistory', 'remove', 'closeRun', 'start', 'refresh', 'refreshReport',
])
export function isWorkflowDetachedNoArgumentAction(name: WorkflowDetachedAction) {
  return noArgumentActions.has(name)
}
export interface WorkflowDetachedCommand {
  name: WorkflowDetachedAction
  args: unknown[]
  owner?: string
  inputSequence?: number
}
export const workflowDetachedInputs = ['change', 'selectStep', 'target', 'view', 'changeRun', 'presentation'] as const
export const workflowMediaLimit = 32 * 1024 * 1024
export type WorkflowDetachedMedia =
  | { kind: 'ocr-defaults' }
  | { kind: 'ocr-preview'; id: string; request: string; query: WorkflowOCRQuery }
  | { kind: 'ocr-cancel'; id: string; request: string }
  | { kind: 'ocr-report'; id: string; index: number; offset: number; limit: number }
  | { kind: 'runtime-status' }
  | { kind: 'runtime-warmup' }
  | { kind: 'runtime-settings' }
  | { kind: 'analysis'; request: AnalysisMediaRequest; read_id?: string }
  | { kind: 'analysis-read-cancel'; id: string }
  | { kind: 'open'; session: string; generation: number }
  | { kind: 'close' | 'capture' | 'asset'; id: string }
  | { kind: 'match'; id: string; target: Record<string, unknown> }
  | { kind: 'upload'; bytes: ArrayBuffer; type: string }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')
const fields = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))

function definition(value: unknown): boolean {
  return record(value) && (value.schema_version === 1 || value.schema_version === 2) && Array.isArray(value.parameters) && Array.isArray(value.steps)
    && value.parameters.every(item => record(item) && typeof item.id === 'string' && typeof item.name === 'string' && ['string', 'number', 'boolean'].includes(String(item.type)))
    && value.steps.every(step)
}
function step(value: unknown): boolean {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.kind === 'string' && record(value.action)
    && (value.steps === undefined || Array.isArray(value.steps) && value.steps.every(step))
    && (value.else === undefined || Array.isArray(value.else) && value.else.every(step))
}

// 草稿允许暂时不满足业务校验；这里只限制消息形状、大小和深度，正式保存仍由 Core 校验。
function safeJSON(value: unknown, budget: { size: number }, depth = 0): boolean {
  if (depth > 40 || budget.size > 2 * 1024 * 1024) return false
  if (value === undefined || value === null || typeof value === 'boolean') { budget.size += 4; return true }
  if (typeof value === 'number') { budget.size += 16; return Number.isFinite(value) }
  if (typeof value === 'string') { budget.size += value.length * 2; return budget.size <= 2 * 1024 * 1024 }
  if (Array.isArray(value)) return value.length <= 2000 && value.every(item => safeJSON(item, budget, depth + 1))
  return record(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) =>
    !['__proto__', 'constructor', 'prototype'].includes(key) && safeJSON(key, budget, depth + 1) && safeJSON(item, budget, depth + 1))
}

export function isWorkflowDetachedCommand(value: unknown): value is WorkflowDetachedCommand {
  if (!record(value) || !workflowDetachedActions.includes(value.name as WorkflowDetachedAction) || !Array.isArray(value.args) || value.args.length > 1) return false
  if (value.owner !== undefined && !id(value.owner)) return false
  const input = (workflowDetachedInputs as readonly string[]).includes(String(value.name))
  if (input !== (value.inputSequence !== undefined) || input && (!Number.isSafeInteger(value.inputSequence) || Number(value.inputSequence) < 1)) return false
  if (!safeJSON(value.args, { size: 0 })) return false
  const [arg] = value.args
  switch (value.name) {
    case 'create': case 'copy': return value.args.length === 1 && typeof arg === 'string' && arg.length <= 240
    case 'load': case 'showRun': case 'viewDesktop': case 'dismissNotice': return value.args.length === 1 && id(arg)
    case 'selectStep': return value.args.length === 1 && (arg === undefined || id(arg))
    case 'view': return value.args.length === 1 && ['scripts', 'runs'].includes(String(arg))
    case 'control': return value.args.length === 1 && ['pause', 'resume', 'step', 'cancel'].includes(String(arg))
    case 'openRun': return value.args.length === 1 && typeof arg === 'boolean'
    case 'restore': return value.args.length === 1 && Number.isSafeInteger(arg) && Number(arg) > 0
    case 'change': return record(arg) && fields(arg, ['name', 'description', 'tags', 'definition'])
      && (arg.name === undefined || typeof arg.name === 'string') && (arg.description === undefined || typeof arg.description === 'string')
      && (arg.tags === undefined || strings(arg.tags)) && (arg.definition === undefined || definition(arg.definition))
    case 'target': return record(arg) && ['session', 'profile'].includes(String(arg.mode)) && (arg.id === undefined || id(arg.id))
      && (arg.connectionGeneration === undefined || Number.isSafeInteger(arg.connectionGeneration) && Number(arg.connectionGeneration) > 0)
    case 'changeRun': return record(arg) && fields(arg, ['takeover', 'keep', 'parameters'])
      && (arg.takeover === undefined || typeof arg.takeover === 'boolean') && (arg.keep === undefined || typeof arg.keep === 'boolean')
      && (arg.parameters === undefined || record(arg.parameters) && Object.values(arg.parameters).every(value => ['string', 'number', 'boolean'].includes(typeof value)))
    case 'presentation': return record(arg) && fields(arg, ['catalogCollapsed', 'propertiesVisible', 'chainCollapsed', 'editorPanels', 'foldedSteps', 'queries', 'runFilter', 'reportExpansion', 'analysis'])
      && (arg.chainCollapsed === undefined || typeof arg.chainCollapsed === 'boolean')
      && (arg.editorPanels === undefined || isWorkflowEditorPanels(arg.editorPanels))
      && (arg.analysis === undefined || record(arg.analysis) && fields(arg.analysis, ['open', 'id', 'layer', 'filter', 'selected', 'history', 'view', 'panels', 'resultsVisible'])
        && (arg.analysis.resultsVisible === undefined || typeof arg.analysis.resultsVisible === 'boolean')
        && (arg.analysis.panels === undefined || record(arg.analysis.panels) && fields(arg.analysis.panels, ['historyWidth', 'resultsWidth'])
          && (['history', 'results'] as const).every(side => {
            const value = (arg.analysis as Record<string, unknown>).panels as Record<string, unknown>
            const width = value[`${side}Width`]
            return typeof width === 'number' && Number.isFinite(width) && width >= analysisPanelLimits[side].min && width <= analysisPanelLimits[side].max
          }))
        && typeof arg.analysis.open === 'boolean' && typeof arg.analysis.history === 'boolean' && ['elements', 'ocr'].includes(String(arg.analysis.layer))
        && (arg.analysis.id === undefined || id(arg.analysis.id)) && record(arg.analysis.filter)
        && isAnalysisMediaRequest({ operation: 'elements', id: 'presentation', query: arg.analysis.filter })
        && (arg.analysis.view === undefined || record(arg.analysis.view) && fields(arg.analysis.view, ['zoom', 'boxes'])
          && typeof arg.analysis.view.boxes === 'boolean' && (arg.analysis.view.zoom === 'fit' || typeof arg.analysis.view.zoom === 'number' && Number.isFinite(arg.analysis.view.zoom) && arg.analysis.view.zoom > 0 && arg.analysis.view.zoom <= 4))
        && (arg.analysis.selected === undefined || Number.isSafeInteger(arg.analysis.selected) && Number(arg.analysis.selected) >= 0 && Number(arg.analysis.selected) < 1300))
      && (arg.catalogCollapsed === undefined || typeof arg.catalogCollapsed === 'boolean') && (arg.propertiesVisible === undefined || typeof arg.propertiesVisible === 'boolean')
      && (arg.foldedSteps === undefined || strings(arg.foldedSteps)) && (arg.runFilter === undefined || ['all', 'active'].includes(String(arg.runFilter)))
      && (arg.queries === undefined || record(arg.queries) && fields(arg.queries, ['scripts', 'runs']) && typeof arg.queries.scripts === 'string' && typeof arg.queries.runs === 'string')
      && (arg.reportExpansion === undefined || record(arg.reportExpansion) && fields(arg.reportExpansion, ['runID', 'allExpanded', 'exceptions'])
        && id(arg.reportExpansion.runID) && typeof arg.reportExpansion.allExpanded === 'boolean' && strings(arg.reportExpansion.exceptions))
    default: return isWorkflowDetachedNoArgumentAction(value.name as WorkflowDetachedAction) && value.args.length === 0
  }
}

export function isWorkflowDetachedMedia(value: unknown): value is WorkflowDetachedMedia {
  if (!record(value)) return false
  if (value.kind === 'ocr-defaults') return fields(value, ['kind'])
  if (value.kind === 'ocr-preview') return fields(value, ['kind','id','request','query']) && id(value.id) && id(value.request) && isWorkflowOCRQuery(value.query)
  if (value.kind === 'ocr-cancel') return fields(value, ['kind','id','request']) && id(value.id) && id(value.request)
  if (value.kind === 'ocr-report') return fields(value, ['kind','id','index','offset','limit']) && id(value.id) && Number.isSafeInteger(value.index) && Number(value.index) > 0 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number.isSafeInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 100
  if (value.kind === 'runtime-status' || value.kind === 'runtime-settings' || value.kind === 'runtime-warmup') return fields(value, ['kind'])
  if (value.kind === 'analysis-read-cancel') return fields(value, ['kind', 'id']) && id(value.id)
  if (value.kind === 'analysis') return fields(value, ['kind', 'request', 'read_id']) && isAnalysisMediaRequest(value.request) && (value.read_id === undefined || id(value.read_id))
  if (value.kind === 'upload') return value.bytes instanceof ArrayBuffer && value.bytes.byteLength > 0
    && value.bytes.byteLength <= 8 * 1024 * 1024 && ['image/png', 'image/jpeg'].includes(String(value.type))
  if (value.kind === 'open') return id(value.session) && Number.isSafeInteger(value.generation) && Number(value.generation) > 0
  if (['close', 'capture', 'asset'].includes(String(value.kind))) return id(value.id)
  return value.kind === 'match' && id(value.id) && record(value.target) && safeJSON(value.target, { size: 0 })
}
