import type { DevicePlatform } from '#common/contracts'

export function normalizeDevicePlatform(value: unknown): DevicePlatform {
  return value === 'windows' || value === 'linux' || value === 'darwin' || value === 'android' ? value : 'unknown'
}

export const devicePlatformNames = { windows: 'Windows', linux: 'Linux', darwin: 'macOS', android: 'Android' } as const
