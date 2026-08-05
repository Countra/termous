import type {
  UpdateRuntimeSummaryRefreshRequest,
  UpdateRuntimeSummaryReportContext,
} from '#common/contracts'

export type {
  UpdateRuntimeSummaryRefreshRequest,
  UpdateRuntimeSummaryReportContext,
} from '#common/contracts'

export interface UpdateRuntimeSummaryRefreshIdentity {
  senderId: number
  requestId: string
  documentEpoch: string
}

interface UpdateRuntimeSummaryReportDecisionInput {
  senderId: number
  currentSenderId: number | null
  currentDocumentEpoch: string | null
  context: UpdateRuntimeSummaryReportContext | null
  refresh: UpdateRuntimeSummaryRefreshIdentity | null
}

export function decideRuntimeSummaryReport(
  input: UpdateRuntimeSummaryReportDecisionInput,
) {
  const context = input.context
  if (
    !context
    || input.senderId !== input.currentSenderId
    || context.document_epoch !== input.currentDocumentEpoch
  ) {
    return {
      accept: false,
      completes_refresh: false,
    }
  }

  if (input.refresh) {
    const matchesRefresh = (
      input.senderId === input.refresh.senderId
      && context.document_epoch === input.refresh.documentEpoch
      && context.request_id === input.refresh.requestId
    )
    return {
      accept: matchesRefresh,
      completes_refresh: matchesRefresh,
    }
  }

  return {
    accept: context.request_id === undefined,
    completes_refresh: false,
  }
}

export function normalizeRuntimeSummaryRefreshRequest(
  value: unknown,
): UpdateRuntimeSummaryRefreshRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    !isRuntimeSummaryIdentityPart(record.request_id)
    || !isRuntimeSummaryIdentityPart(record.document_epoch)
  ) {
    return null
  }
  return {
    request_id: record.request_id,
    document_epoch: record.document_epoch,
  }
}

export function normalizeRuntimeSummaryReportContext(
  value: unknown,
): UpdateRuntimeSummaryReportContext | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    !isRuntimeSummaryIdentityPart(record.document_epoch)
    || (
      record.request_id !== undefined
      && !isRuntimeSummaryIdentityPart(record.request_id)
    )
  ) {
    return null
  }
  return {
    document_epoch: record.document_epoch,
    ...(record.request_id === undefined
      ? {}
      : { request_id: record.request_id }),
  }
}

function isRuntimeSummaryIdentityPart(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 128
  )
}
