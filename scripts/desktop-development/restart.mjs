export async function stopDevelopmentProcess(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  // 只等待 Vite 持有的子进程，不能凭进程名终止正式版或外部 Core。
  child.removeListener('exit', process.exit)
  await new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); child.removeListener('exit', stopped); child.removeListener('error', failed) }
    const stopped = () => { finish(); resolve() }
    const failed = error => { finish(); reject(error) }
    const timer = setTimeout(() => { finish(); reject(new Error('Termous Dev 尚未退出，请关闭开发版后重试')) }, timeoutMs)
    child.once('exit', stopped)
    child.once('error', failed)
    try { child.kill() }
    catch (error) { finish(); reject(error) }
  })
}
