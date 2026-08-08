import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readClipboardText,
  writeClipboardText,
} from './terminalClipboard'

const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termous')
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
    return
  }
  Reflect.deleteProperty(target, property)
}

afterEach(() => {
  restoreProperty(window, 'termous', originalBridgeDescriptor)
  restoreProperty(navigator, 'clipboard', originalClipboardDescriptor)
  restoreProperty(document, 'execCommand', originalExecCommandDescriptor)
  document.querySelectorAll('textarea').forEach((textarea) => textarea.remove())
  vi.restoreAllMocks()
})

describe('终端剪贴板适配', () => {
  it('优先使用桌面桥接读写剪贴板', async () => {
    const readText = vi.fn().mockResolvedValue('bridge text')
    const writeText = vi.fn().mockResolvedValue(undefined)
    const navigatorReadText = vi.fn().mockResolvedValue('navigator text')
    const navigatorWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'termous', {
      configurable: true,
      value: { clipboard: { readText, writeText } },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: navigatorReadText, writeText: navigatorWriteText },
    })

    await expect(readClipboardText()).resolves.toBe('bridge text')
    await expect(writeClipboardText('payload')).resolves.toBeUndefined()
    expect(readText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('payload')
    expect(navigatorReadText).not.toHaveBeenCalled()
    expect(navigatorWriteText).not.toHaveBeenCalled()
  })

  it('桥接和浏览器 API 缺失时使用临时文本框并始终清理', async () => {
    Reflect.deleteProperty(window, 'termous')
    Reflect.deleteProperty(navigator, 'clipboard')
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    await expect(writeClipboardText('fallback text')).resolves.toBeUndefined()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('没有可用读取能力或复制失败时保持原错误语义', async () => {
    Reflect.deleteProperty(window, 'termous')
    Reflect.deleteProperty(navigator, 'clipboard')
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })

    await expect(readClipboardText()).rejects.toThrow('clipboard read unavailable')
    await expect(writeClipboardText('unavailable')).rejects.toThrow('clipboard write unavailable')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
