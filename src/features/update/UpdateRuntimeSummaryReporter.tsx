import { useEffect, useMemo, useRef } from 'react'
import { useTransferRuntime } from '../../app/useTransferRuntime'
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
  const summary = useMemo(() => buildUpdateRuntimeSummary({
    activeTransferCount: activeTransfers.length,
    fileSessions,
    forwards,
    sessions,
    transferSnapshotComplete: apiReady && initialized,
  }), [activeTransfers.length, apiReady, fileSessions, forwards, initialized, sessions])
  const bridge = window.termous?.updates

  useEffect(() => {
    if (!bridge) {
      return
    }
    const publisher = new UpdateRuntimeSummaryPublisher(
      (next) => bridge.reportRuntimeSummary(next),
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
    return () => {
      publisher.dispose()
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
