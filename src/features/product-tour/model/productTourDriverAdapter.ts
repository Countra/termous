import { driver, type Config, type Driver } from 'driver.js'

export interface ProductTourDriverAdapter {
  drive: (stepIndex?: number) => void
  moveTo: (stepIndex: number) => void
  destroy: () => void
  getActiveIndex: () => number | undefined
}

export type ProductTourDriverFactory = (config: Config) => ProductTourDriverAdapter

export const createProductTourDriver: ProductTourDriverFactory = (config) => {
  const instance: Driver = driver(config)
  return {
    drive: (stepIndex) => instance.drive(stepIndex),
    moveTo: (stepIndex) => instance.moveTo(stepIndex),
    destroy: () => instance.destroy(),
    getActiveIndex: () => instance.getActiveIndex(),
  }
}
