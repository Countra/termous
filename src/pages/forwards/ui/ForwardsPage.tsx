import {
  ForwardManagementWorkspace,
  type ForwardManagementWorkspaceProps,
} from '#features/forwards'

export type ForwardsPageProps = ForwardManagementWorkspaceProps

export function ForwardsPage(props: ForwardsPageProps) {
  return <ForwardManagementWorkspace {...props} />
}
