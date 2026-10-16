// 被其他原生窗口遮挡时 requestAnimationFrame 可能暂停，交接不能依赖它无限等待。
export function settleDetachedRender() {
  return new Promise<void>(resolve => {
    let frame = 0
    const finish = () => { clearTimeout(timer); cancelAnimationFrame(frame); resolve() }
    const timer = setTimeout(finish, 160)
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish) })
  })
}
