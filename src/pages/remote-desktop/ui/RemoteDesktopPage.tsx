import {
  RemoteDesktopWorkspace,
  type RemoteDesktopWorkspaceProps,
} from '#widgets/remote-desktop-workspace'

export type RemoteDesktopPageProps = RemoteDesktopWorkspaceProps

export function RemoteDesktopPage(props: RemoteDesktopPageProps) {
  return <RemoteDesktopWorkspace {...props} />
}
