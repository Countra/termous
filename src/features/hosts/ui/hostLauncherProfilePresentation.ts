import type { TFunction } from 'i18next'
import {
  formatDateTime,
} from '../model/hostLauncherListModel.ts'
import type {
  HostLauncherCredentialSummary,
  HostLauncherProxySummary,
  HostLauncherResolvedProfileDetails,
} from '../model/hostLauncherProfileDetails.ts'
import type { HostLauncherProfileMenuItem } from '../model/hostLauncherProfiles.ts'

export function profileDetail(
  item: HostLauncherProfileMenuItem,
  t: TFunction,
) {
  if (item.availability !== 'ready') {
    return t('workbench.hostLauncher.profiles.routeMissing')
  }
  if (item.route && item.intent === 'remote_desktop') {
    return t('workbench.hostLauncher.profiles.desktopDetail', {
      endpoint: item.endpoint,
      route: item.route.name,
    })
  }
  if (item.intent === 'remote_desktop') {
    return t('workbench.hostLauncher.profiles.desktopDirectDetail', {
      endpoint: item.endpoint,
    })
  }
  if (item.route) {
    return t('workbench.hostLauncher.profiles.fileDetail', {
      endpoint: item.endpoint,
      route: item.route.name,
    })
  }
  return item.endpoint
}

export function credentialLabel(
  credential: HostLauncherCredentialSummary,
  t: TFunction,
) {
  return `${credential.name} · ${t(`vault.typeName.${credential.type}`)}`
}

export function proxyTypeLabel(
  type: HostLauncherProxySummary['type'],
  t: TFunction,
) {
  return t(`proxies.types.${type === 'http_connect' ? 'httpConnect' : 'socks5'}`)
}

export function accessibleProfileDetails(
  profile: HostLauncherProfileMenuItem,
  details: HostLauncherResolvedProfileDetails | null,
  t: TFunction,
) {
  if (!details) return []
  const facts: string[] = []
  const add = (label: string, value: string) => {
    if (value) facts.push(`${label}: ${value}`)
  }
  if (details.sshCredential) {
    add(
      profile.intent === 'remote_desktop'
        ? t('workbench.hostLauncher.profiles.details.sshCredential')
        : t('hosts.credential'),
      credentialLabel(details.sshCredential, t),
    )
  }
  const desktop = details.remoteDesktop
  if (desktop) {
    add(
      t('workbench.hostLauncher.profiles.details.targetCredential'),
      desktop.targetCredential
        ? credentialLabel(desktop.targetCredential, t)
        : t('fields.none'),
    )
  }
  if (details.jump) {
    add(
      t('hosts.jumpHost'),
      [
        details.jump.hostName,
        details.jump.profileName,
        details.jump.endpoint,
        details.jump.credential ? credentialLabel(details.jump.credential, t) : '',
      ].filter(Boolean).join(' · '),
    )
  }
  if (details.proxy) {
    add(
      t('hosts.proxy'),
      `${details.proxy.name} · ${proxyTypeLabel(details.proxy.type, t)}`,
    )
  }
  add(t('workbench.hostLauncher.profiles.details.fingerprint'), details.fingerprint)
  if (details.lastConnectedAt) {
    add(
      t('workbench.hostLauncher.lastConnected'),
      formatDateTime(details.lastConnectedAt, t('fields.none')),
    )
  }
  add(t('workbench.hostLauncher.profiles.details.lastDirectory'), details.lastDirectory)
  if (desktop) {
    add(t('remoteDesktop.description'), desktop.description)
    add(
      t('remoteDesktop.shared'),
      desktop.shared ? t('remoteDesktop.enabled') : t('remoteDesktop.disabled'),
    )
    add(
      t('remoteDesktop.viewOnly'),
      desktop.viewOnly ? t('remoteDesktop.enabled') : t('remoteDesktop.disabled'),
    )
    add(t('remoteDesktop.displayMode'), t(`remoteDesktop.display.${desktop.displayMode}`))
  }
  return facts
}
