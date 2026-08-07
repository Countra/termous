import { FilesWorkspace, type FilesWorkspaceProps } from '#widgets/files-workspace'

export type FilesPageProps = FilesWorkspaceProps

export function FilesPage(props: FilesPageProps) {
  return <FilesWorkspace {...props} />
}
