import type { CodeSnippet, CodeSnippetInput } from './types.ts'

export interface SnippetRiskAnalysis {
  risky: boolean
  reasons: string[]
}

const variablePattern = /\{\{\s*([a-zA-Z_][\w.-]{0,63})\s*\}\}/g

const riskyPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[^\n;&|]*r[^\n;&|]*f\b/i, reason: 'recursiveDelete' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'powerControl' },
  { pattern: /\bmkfs(?:\.|\s)/i, reason: 'formatDisk' },
  { pattern: /\bdd\s+[^\n;&|]*\bof=\/dev\//i, reason: 'rawDiskWrite' },
  { pattern: />\s*\/dev\/(?:sd|vd|xvd|nvme)/i, reason: 'rawDeviceOverwrite' },
  { pattern: /\b(systemctl|service)\s+(stop|restart|disable)\s+\S+/i, reason: 'serviceControl' },
  { pattern: /\b(iptables|nft)\s+(-F|flush)\b/i, reason: 'firewallFlush' },
  { pattern: /\bufw\s+disable\b/i, reason: 'firewallDisable' },
  { pattern: /\b(chmod|chown)\s+-R\s+[^\n;&|]+\s+\/(?:\s|$)/i, reason: 'recursiveRootChange' },
  { pattern: /\bDROP\s+DATABASE\b/i, reason: 'databaseDrop' },
]

export function extractSnippetVariables(command: string) {
  const variables: string[] = []
  const seen = new Set<string>()
  for (const match of command.matchAll(variablePattern)) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      variables.push(name)
    }
  }
  return variables
}

export function renderSnippetCommand(command: string, values: Record<string, string>) {
  return command.replace(variablePattern, (_, name: string) => values[name] ?? '')
}

export function analyzeSnippetRisk(command: string): SnippetRiskAnalysis {
  const reasons = riskyPatterns.filter((item) => item.pattern.test(command)).map((item) => item.reason)
  return { risky: reasons.length > 0, reasons }
}

export function normalizeSnippetInput(input: CodeSnippetInput): CodeSnippetInput {
  return {
    group_id: input.group_id.trim(),
    name: input.name.trim(),
    description: input.description.trim(),
    command: input.command.trim(),
    tags: normalizeSnippetTags(input.tags),
    shell: input.shell || 'any',
    favorite: input.favorite,
  }
}

export function snippetToInput(snippet: CodeSnippet): CodeSnippetInput {
  return {
    group_id: snippet.group_id ?? '',
    name: snippet.name,
    description: snippet.description ?? '',
    command: snippet.command,
    tags: snippet.tags ?? [],
    shell: snippet.shell || 'any',
    favorite: snippet.favorite,
  }
}

export function normalizeSnippetTags(tags: string[]) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const clean = tag.trim().replace(/\s+/g, ' ')
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(clean)
  }
  return result.sort((left, right) => left.localeCompare(right))
}
