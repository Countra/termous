import { getTermousBridge } from '#shared/bridge'

export async function readClipboardText() {
  const clipboardBridge = getTermousBridge()?.clipboard
  if (clipboardBridge?.readText) {
    return clipboardBridge.readText()
  }
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }
  throw new Error('clipboard read unavailable')
}

export async function writeClipboardText(text: string) {
  const clipboardBridge = getTermousBridge()?.clipboard
  if (clipboardBridge?.writeText) {
    await clipboardBridge.writeText(text)
    return
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  if (fallbackCopyText(text)) {
    return
  }
  throw new Error('clipboard write unavailable')
}

function fallbackCopyText(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}
