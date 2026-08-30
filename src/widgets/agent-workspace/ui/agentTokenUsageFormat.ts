export function formatAgentTokenCount(value: number, language?: string) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
  return new Intl.NumberFormat(language).format(normalized)
}
