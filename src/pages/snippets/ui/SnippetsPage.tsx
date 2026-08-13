import {
  SnippetManagementWorkspace,
  type SnippetManagementWorkspaceProps,
} from '#features/snippets'

export type SnippetsPageProps = SnippetManagementWorkspaceProps

export function SnippetsPage(props: SnippetsPageProps) {
  return <SnippetManagementWorkspace {...props} />
}
