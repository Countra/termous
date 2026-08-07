export type DetailsTabKey =
  | 'overview'
  | 'files'
  | 'system'
  | 'monitor'
  | 'processes'
  | 'services'
  | 'docker'
  | 'firewall'
  | 'forwards'
  | 'aliases'
  | 'snippets'

export function parseDetailsTabKey(value: unknown): DetailsTabKey {
  return value === 'files' ||
    value === 'system' ||
    value === 'monitor' ||
    value === 'processes' ||
    value === 'services' ||
    value === 'docker' ||
    value === 'firewall' ||
    value === 'forwards' ||
    value === 'aliases' ||
    value === 'snippets' ||
    value === 'overview'
    ? value
    : 'overview'
}
