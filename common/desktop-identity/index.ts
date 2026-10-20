import identities from './identities.json' with { type: 'json' }

export type DesktopChannel = keyof typeof identities
export type DesktopIdentity = (typeof identities)[DesktopChannel]
export const desktopIdentities = identities

export function desktopIdentity(channel: unknown): DesktopIdentity {
  if (channel !== 'production' && channel !== 'development') throw new Error('桌面渠道无效')
  return identities[channel]
}

export function assertDesktopChannel(channel: DesktopChannel, metadata: unknown) {
  if (metadata !== channel) throw new Error('开发壳或安装包与主进程渠道不一致，请重新构建')
}
