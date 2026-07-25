import { useEffect, useState } from 'react'
import type { UpdateWindowBootstrap } from '../../../electron/updateWindow'
import type { UpdateSnapshot } from '../../../electron/updateTypes'
import { TermousUiProvider } from '../../app/TermousUiProvider'
import type { Language, ThemeMode } from '../../types/domain'
import './update-window.css'

const initialBootstrap: UpdateWindowBootstrap<UpdateSnapshot> = {
  bootstrap_seq: 0,
  intent: 'inspect',
  language: navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US',
  snapshot: {
    state_seq: 0,
    operation_generation: 0,
    phase: 'idle',
    current_version: '',
    available_version: null,
    release_name: null,
    release_date: null,
    release_url: null,
    release_notes: null,
    progress: null,
    checked_at: null,
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: 0,
    },
    next_automatic_check_at: null,
  },
  theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
}

export default function UpdateWindowRoot() {
  const [bootstrap, setBootstrap] = useState(initialBootstrap)

  useEffect(() => {
    const bridge = window.termousUpdate
    if (!bridge) {
      return
    }
    const merge = (next: UpdateWindowBootstrap<UpdateSnapshot>) => {
      setBootstrap((current) => (
        next.bootstrap_seq >= current.bootstrap_seq ? next : current
      ))
    }
    const removeBootstrapListener = bridge.onBootstrapChanged(merge)
    void bridge.getBootstrap().then(merge).catch(() => {
      console.error('[termous:update] 无法读取更新窗口启动状态')
    })
    const removeStateListener = bridge.subscribe((snapshot) => {
      setBootstrap((current) => (
        snapshot.state_seq >= current.snapshot.state_seq
          ? { ...current, snapshot }
          : current
      ))
    })
    return () => {
      removeBootstrapListener()
      removeStateListener()
    }
  }, [])

  return (
    <TermousUiProvider
      language={bootstrap.language as Language}
      theme={bootstrap.theme as ThemeMode}
    >
      <main
        className="update-window-bootstrap"
        data-update-phase={bootstrap.snapshot.phase ?? 'idle'}
        aria-busy="true"
      >
        <span className="update-window-bootstrap-mark" aria-hidden="true" />
        <strong>Termous</strong>
      </main>
    </TermousUiProvider>
  )
}
