import { afterEach, expect, test, vi } from 'vitest'
import { createRdpIme } from './ime'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function fixture() {
  const target = document.createElement('div'), canvas = document.createElement('canvas')
  document.body.appendChild(target); target.appendChild(canvas)
  let rect = { left: 200, top: 50, width: 400, height: 300 }
  vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => ({ left: 100, top: 50, width: 600, height: 300 }) as DOMRect)
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect)
  let authority: string | undefined = '1'
  const commit = vi.fn()
  const ime = createRdpIme({ target, canvas, size: () => ({ width: 800, height: 600 }), authority: () => authority, commit })
  target.appendChild(ime.element)
  return { target, ime, commit, changeRect: (next: typeof rect) => { rect = next }, changeAuthority: (next: string | undefined) => { authority = next } }
}

test('输入法锚点转换包含画面居中、缩放、滚动与边界约束', () => {
  const f = fixture()
  f.ime.focus({ x: 400, y: 200 })
  expect(f.ime.element.style.left).toBe('300px')
  expect(f.ime.element.style.top).toBe('100px')
  f.changeRect({ left: -100, top: -100, width: 800, height: 600 })
  f.target.scrollLeft = 200; f.target.scrollTop = 150
  f.ime.refresh()
  expect(f.ime.element.style.left).toBe('400px')
  expect(f.ime.element.style.top).toBe('200px')
  f.ime.focus({ x: 799, y: 599 })
  expect(f.ime.element.style.top).toBe('430px')
  f.ime.dispose()
})

test('中文组合只确认一次，普通聚焦保持组合位置', () => {
  const f = fixture()
  f.ime.focus({ x: 100, y: 100 })
  f.ime.element.dispatchEvent(new CompositionEvent('compositionstart'))
  f.ime.element.value = 'zhong'
  f.ime.element.dispatchEvent(new InputEvent('input', { isComposing: true, data: 'zhong' }))
  f.ime.focus()
  expect(f.ime.element.style.left).toBe('150px')
  expect(f.commit).not.toHaveBeenCalled()
  f.ime.element.dispatchEvent(new CompositionEvent('compositionend', { data: '中文' }))
  f.ime.element.dispatchEvent(new InputEvent('input', { data: '中文' }))
  expect(f.commit).toHaveBeenCalledExactlyOnceWith('中文')
  expect(f.ime.element.value).toBe('')
  f.ime.dispose()
})

test('点击新目标先取消旧组合，迟到确认不会发送到新的远端位置', () => {
  const f = fixture()
  f.ime.focus({ x: 100, y: 100 })
  f.ime.element.dispatchEvent(new CompositionEvent('compositionstart'))
  f.ime.element.value = '旧输入'
  f.ime.focus({ x: 600, y: 400 })
  expect(f.ime.element.style.left).toBe('400px')
  expect(f.ime.element.style.top).toBe('200px')
  f.ime.element.dispatchEvent(new CompositionEvent('compositionend', { data: '旧输入' }))
  expect(f.commit).not.toHaveBeenCalled()
  f.ime.element.dispatchEvent(new CompositionEvent('compositionstart'))
  f.ime.element.dispatchEvent(new CompositionEvent('compositionend', { data: '新输入' }))
  expect(f.commit).toHaveBeenCalledExactlyOnceWith('新输入')
  f.ime.dispose()
})

test.each(['authority', 'blur', 'reset'])('组合输入在 %s 后不补发', reason => {
  const f = fixture()
  f.ime.focus()
  f.ime.element.dispatchEvent(new CompositionEvent('compositionstart'))
  if (reason === 'authority') f.changeAuthority('2')
  else if (reason === 'blur') f.ime.element.blur()
  else f.ime.reset()
  f.ime.element.dispatchEvent(new CompositionEvent('compositionend', { data: '旧输入' }))
  expect(f.commit).not.toHaveBeenCalled()
  f.ime.dispose()
})
