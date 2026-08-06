import {
  HostManagementWorkspace,
  type HostManagementWorkspaceProps,
} from '#features/hosts'

export type HostsPageProps = HostManagementWorkspaceProps

export function HostsPage(props: HostsPageProps) {
  return <HostManagementWorkspace {...props} />
}
