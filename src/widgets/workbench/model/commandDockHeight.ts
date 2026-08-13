export const commandDockHeightLimits = Object.freeze({
  default: 262,
  min: 200,
  max: 520,
  terminalMin: 240,
})

export interface CommandDockHeightBounds {
  min: number
  max: number
}

export function parseCommandDockHeight(value: unknown) {
  const height = typeof value === 'number' && Number.isFinite(value)
    ? value
    : commandDockHeightLimits.default
  return clampCommandDockHeight(height, commandDockHeightLimits.min, commandDockHeightLimits.max)
}

export function resolveCommandDockHeightBounds(
  terminalHeight: number,
  dockHeight: number,
): CommandDockHeightBounds {
  const availableHeight = Math.max(0, Math.floor(terminalHeight) + Math.floor(dockHeight))
  const maximum = Math.max(
    0,
    Math.min(commandDockHeightLimits.max, availableHeight - commandDockHeightLimits.terminalMin),
  )
  return {
    min: Math.min(commandDockHeightLimits.min, maximum),
    max: maximum,
  }
}

export function clampCommandDockHeight(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}
