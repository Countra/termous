import { createContext, useContext } from 'react'
import type { GlobalFileSearchRuntimeValue } from '../model/types'

export const GlobalFileSearchRuntimeContext = createContext<GlobalFileSearchRuntimeValue | null>(null)

export function useGlobalFileSearchRuntime() {
  const value = useContext(GlobalFileSearchRuntimeContext)
  if (!value) {
    throw new Error('GlobalFileSearchRuntimeProvider is missing')
  }
  return value
}
