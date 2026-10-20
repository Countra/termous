import { stopDevelopmentProcess } from './restart.mjs'

export function createDevelopmentStarter({ prepare, child, cwd, report, stop = stopDevelopmentProcess }) {
  let pending = Promise.resolve()
  let closed = false
  return {
    run({ startup, reload }, restart = false) {
      const next = pending.then(async () => {
        if (closed) return
        const current = child()
        if (!restart && current && current.exitCode === null && current.signalCode === null) {
          reload()
          return
        }
        // 首次构建可能由任一 preload 完成，统一从此处启动专属壳。
        const launcher = await prepare()
        if (closed) return
        await stop(current)
        if (!closed) await startup(['--termous-development-start'], { cwd }, launcher)
      })
      // 插件不会等待 onstart；显式接住失败并报告，后续编译仍可恢复。
      pending = next.catch(report)
      return pending
    },
    async close() {
      closed = true
      await pending
      await stop(child())
    },
  }
}
