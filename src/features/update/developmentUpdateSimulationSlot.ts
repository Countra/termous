import type { DevelopmentUpdateSimulation } from './developmentUpdateSimulation'

let simulation: DevelopmentUpdateSimulation | null = null

export function installDevelopmentUpdateSimulation(
  next: DevelopmentUpdateSimulation,
) {
  simulation = next
}

export function readDevelopmentUpdateSimulation() {
  return simulation
}
