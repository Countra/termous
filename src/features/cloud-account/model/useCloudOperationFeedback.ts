import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { TermousApiError } from '#shared/api'

export function cloudOperationErrorCode(cause: unknown, known: (code: string) => boolean): string {
  const code = cause instanceof TermousApiError
    ? cause.code === 'CLOUD_OPERATION_FAILED' ? cause.message : cause.code
    : cause instanceof Error && known(cause.message) ? cause.message : 'local_failed'
  // 仅向界面传递受控标识，异常正文可能包含敏感输入或未受信任的服务文本。
  return /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(code) ? code : 'local_failed'
}

export function useCloudOperationFeedback(api: CloudGateway, generation: string, run: <T>(action: () => Promise<T>) => Promise<T | undefined>) {
  const { i18n } = useTranslation()
  const [errorCode, setErrorCode] = useState<string>()
  const [working, setWorking] = useState(false)
  const life = useRef({ active: true, api, generation, request: 0, pending: false })
  useEffect(() => {
    const scope = { active: true, api, generation, request: 0, pending: false }
    life.current = scope
    setErrorCode(undefined); setWorking(false)
    return () => { scope.active = false }
  }, [api, generation])
  const reset = () => {
    const scope = life.current
    if (!scope.active || scope.api !== api || scope.generation !== generation) return
    scope.request++; setErrorCode(undefined)
  }
  const perform = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    const scope = life.current
    if (!scope.active || scope.api !== api || scope.generation !== generation || scope.pending || api.getStatus()?.generation !== generation) return
    const request = scope.request
    const current = () => scope.active && request === scope.request && api.getStatus()?.generation === generation
    scope.pending = true; setWorking(true); setErrorCode(undefined)
    try {
      await run(async () => {
        if (!current()) return
        try { await action(current) } catch (cause) {
          const code = cloudOperationErrorCode(cause, value => i18n.exists(`cloud.errors.${value}`))
          if (current()) setErrorCode(code)
          throw Object.assign(new Error(code), { cause })
        }
      })
    } finally {
      scope.pending = false
      if (scope.active) setWorking(false)
    }
  }
  return { errorCode, working, perform, reset }
}
