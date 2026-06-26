import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export function usePersistentBooleanState(
  key: string,
  defaultValue: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [value, setValue] = useState(() => readBoolean(key, defaultValue))

  useEffect(() => {
    writeBoolean(key, value)
  }, [key, value])

  return [value, setValue]
}

function readBoolean(key: string, defaultValue: boolean) {
  if (typeof window === 'undefined') {
    return defaultValue
  }

  try {
    const rawValue = window.localStorage.getItem(key)
    if (rawValue === 'true') {
      return true
    }
    if (rawValue === 'false') {
      return false
    }
  } catch {
    return defaultValue
  }

  return defaultValue
}

function writeBoolean(key: string, value: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 本地缓存不可用时只保留当前运行中的内存状态。
  }
}
