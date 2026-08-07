import type { Dispatch, SetStateAction } from 'react'
import type { AppData } from './appData'

export interface MutableValue<T> {
  current: T
}

export type SetAppData = Dispatch<SetStateAction<AppData>>
