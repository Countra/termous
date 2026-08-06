export type SnippetShell = 'any' | 'sh' | 'bash' | 'zsh' | 'powershell' | 'cmd'

export interface CodeSnippet {
  id: string
  group_id: string
  name: string
  description?: string
  command: string
  tags: string[]
  shell: SnippetShell
  favorite: boolean
  use_count: number
  last_used_at?: string
  created_at: string
  updated_at: string
}

export interface CodeSnippetInput {
  group_id: string
  name: string
  description: string
  command: string
  tags: string[]
  shell: SnippetShell
  favorite: boolean
}

export interface CodeSnippetGroup {
  id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CodeSnippetGroupInput {
  name: string
  sort_order?: number
}
