import { App as AntdApp, Popover, type InputRef } from 'antd'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { SessionNewTabButton, termousNotificationClassName } from '#shared/ui'
import {
  buildSessionProfileQuickConnectItems,
  filterSessionProfileQuickConnectItems,
  type SessionProfileQuickConnectHost,
  type SessionProfileQuickConnectSource,
} from '../model/sessionProfileQuickConnect.ts'
import { SessionProfileQuickConnectPanel } from './SessionProfileQuickConnectPanel.tsx'
import styles from './SessionQuickConnect.module.scss'

export type SessionProfileQuickConnectProps = SessionProfileQuickConnectSource & {
  hosts: readonly SessionProfileQuickConnectHost[]
  sshAccessProfiles: SSHAccessProfile[]
  triggerLabel: string
  getHostIconUrl?: (iconId: string) => string
  onConnect: (profileId: string) => Promise<unknown>
  onOpenLauncher?: () => void
}

export function SessionProfileQuickConnect(props: SessionProfileQuickConnectProps) {
  const { hosts, sshAccessProfiles, triggerLabel, getHostIconUrl, onConnect, onOpenLauncher } = props
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const openCycle = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<InputRef>(null)
  const panelRef = useRef<HTMLElement>(null)
  const { intent, profiles } = props
  const items = useMemo(() => buildSessionProfileQuickConnectItems(
    intent === 'files' ? { intent, profiles } : { intent, profiles },
    hosts, sshAccessProfiles,
  ), [intent, profiles, hosts, sshAccessProfiles])
  const filteredItems = useMemo(() => filterSessionProfileQuickConnectItems(items, query), [items, query])

  const changeOpen = (next: boolean) => {
    openCycle.current += 1
    setOpen(next)
    if (!next) setQuery('')
  }
  const closeAndFocus = () => {
    changeOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }
  const connect = async (profileId: string) => {
    if (pendingRef.current || !items.some((item) => item.profile.profileId === profileId && !item.unavailableReason)) return
    pendingRef.current = true
    setPendingId(profileId)
    const cycle = openCycle.current
    try {
      await onConnect(profileId)
      // 请求完成不能关闭用户在等待期间重新打开的菜单。
      if (openCycle.current === cycle) {
        const focused = document.activeElement
        // 仅回收菜单内部或因禁用选项丢失的焦点，保留业务层主动聚焦的工作区。
        const restoreFocus = focused === document.body || panelRef.current?.contains(focused)
        changeOpen(false)
        if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
      }
    } catch (error) {
      notification.error({
        title: t('workbench.quickConnect.profiles.connectFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        className: termousNotificationClassName,
      })
    } finally {
      pendingRef.current = false
      setPendingId(null)
    }
  }

  return (
    <Popover open={open} trigger="click" placement="bottomLeft" arrow={false} destroyOnHidden
      classNames={{ root: styles.popover }} onOpenChange={changeOpen}
      afterOpenChange={(visible) => { if (visible) inputRef.current?.focus({ preventScroll: true }) }}
      content={(
        <SessionProfileQuickConnectPanel intent={intent} active={open} inputRef={inputRef} panelRef={panelRef} items={filteredItems} totalCount={items.length}
          query={query} pendingId={pendingId} getHostIconUrl={getHostIconUrl}
          onQueryChange={setQuery} onConnect={(id) => { void connect(id) }} onClose={closeAndFocus}
          onOpenLauncher={onOpenLauncher ? () => { changeOpen(false); onOpenLauncher() } : undefined}
        />
      )}
    >
      <SessionNewTabButton ref={triggerRef} label={triggerLabel} active={open} busy={pendingId !== null}
        aria-haspopup="dialog" aria-expanded={open}
      />
    </Popover>
  )
}
