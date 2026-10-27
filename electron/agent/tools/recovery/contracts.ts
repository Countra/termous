export interface ToolNavigation {
  names: string[]
  guidance: string
  skill?: string
  recovery?: boolean
  observationOnly?: boolean
  empty?: boolean
  prerequisite?: { tool: string; arguments: Record<string, unknown> }
}
