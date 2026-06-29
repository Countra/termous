import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

type Parser<T> = (value: unknown) => T

export function usePersistentJsonState<T>(
  key: string,
  defaultValue: T,
  parse: Parser<T> = (value) => value as T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => readJson(key, defaultValue, parse))

  useEffect(() => {
    writeJson(key, value)
  }, [key, value])

  return [value, setValue]
}

function readJson<T>(key: string, defaultValue: T, parse: Parser<T>) {
  if (typeof window === 'undefined') {
    return defaultValue
  }

  try {
    const rawValue = window.localStorage.getItem(key)
    if (!rawValue) {
      return defaultValue
    }
    return parse(JSON.parse(rawValue))
  } catch {
    return defaultValue
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 本地缓存不可用时只保留当前运行中的内存状态。
  }
}
