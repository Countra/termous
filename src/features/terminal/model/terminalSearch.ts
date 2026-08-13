export interface TerminalSearchOptions {
  caseSensitive: boolean
  regex: boolean
}

export interface TerminalSearchResult {
  found: boolean
  resultIndex: number
  resultCount: number
  error?: 'invalid_regex'
}

export type TerminalSearchDirection = 'next' | 'previous'

export const terminalSearchSeedLimit = 2048

export function normalizeTerminalSearchSeed(value: string) {
  if (!value.trim() || value.length > terminalSearchSeedLimit || /[\r\n]/.test(value)) {
    return ''
  }
  return value
}

export function createEmptyTerminalSearchResult(): TerminalSearchResult {
  return {
    found: false,
    resultIndex: -1,
    resultCount: 0,
  }
}

export function normalizeTerminalSearchEventResult(
  resultIndex: number,
  resultCount: number,
): TerminalSearchResult {
  if (resultCount <= 0) {
    return createEmptyTerminalSearchResult()
  }
  return {
    found: resultIndex >= 0,
    resultIndex,
    resultCount,
  }
}

export function isValidTerminalSearchRegex(term: string, caseSensitive: boolean) {
  try {
    new RegExp(term, caseSensitive ? 'g' : 'gi')
    return true
  } catch {
    return false
  }
}
