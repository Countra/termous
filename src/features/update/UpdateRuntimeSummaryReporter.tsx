import { useEffect, useMemo, useRef } from 'react'
import { getTermousBridge } from '#shared/bridge'
import { useTransferRuntime } from '#features/transfers'
import type { FileSession, ForwardInstance, Session } from '../../types/domain'
import { buildUpdateRuntimeSummary } from './updateRuntimeSummary'
import { UpdateRuntimeSummaryPublisher } from './updateRuntimeSummaryPublisher'

interface UpdateRuntimeSummaryReporterProps {
  apiReady: boolean
  fileSessions: FileSession[]
  forwards: ForwardInstance[]
  sessions: Session[]
}

export function UpdateRuntimeSummaryReporter({
  apiReady,
  fileSessions,
  forwards,
  sessions,
}: UpdateRuntimeSummaryReporterProps) {
  const { activeTransfers, initialized } = useTransferRuntime()
  const publisherRef = useRef<UpdateRuntimeSummaryPublisher | null>(null)
  const failureReportedRef = useRef(false)
  const documentEpochRef = useRef<string | null>(null)
  const summary = useMemo(() => buildUpdateRuntimeSummary({
    activeTransferCount: activeTransfers.length,
    fileSessions,
    forwards,
    sessions,
    transferSnapshotComplete: apiReady && initialized,
  }), [activeTransfers.length, apiReady, fileSessions, forwards, initialized, sessions])
  const summaryRef = useRef(summary)
  summaryRef.current = summary
  const bridge = getTermousBridge()?.updates

  useEffect(() => {
    if (!bridge) {
      return
    }
    const publisher = new UpdateRuntimeSummaryPublisher(
      (next, requestId) => {
        const documentEpoch = documentEpochRef.current
        return bridge.reportRuntimeSummary(
          next,
          documentEpoch
            ? {
                document_epoch: documentEpoch,
                ...(requestId ? { request_id: requestId } : {}),
              }
            : undefined,
        )
      },
      {
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (handle) => window.clearTimeout(handle as number),
      },
      () => {
        if (!failureReportedRef.current) {
          failureReportedRef.current = true
          console.error('[termous:update] 无法同步更新安装影响摘要')
        }
      },
    )
    publisherRef.current = publisher
    const unsubscribeRefreshRequest = bridge.onRuntimeSummaryRequested((request) => {
      documentEpochRef.current = request.document_epoch
      publisher.publish(summaryRef.current)
      publisher.refresh(request.request_id)
    })
    const heartbeat = window.setInterval(() => {
      publisher.refresh()
    }, 15_000)
    return () => {
      window.clearInterval(heartbeat)
      unsubscribeRefreshRequest()
      publisher.dispose()
      documentEpochRef.current = null
      if (publisherRef.current === publisher) {
        publisherRef.current = null
      }
    }
  }, [bridge])

  useEffect(() => {
    publisherRef.current?.publish(summary)
  }, [bridge, summary])

  useEffect(() => {
    if (!apiReady) {
      failureReportedRef.current = false
    }
  }, [apiReady])

  return null
}
