import { AgentWorkerRuntime } from './workerRuntime.ts'

let exitScheduled = false
const parentPort = process.parentPort
if (!parentPort) {
  throw new Error('AGENT_RUNTIME_PARENT_PORT_UNAVAILABLE')
}

const runtime = new AgentWorkerRuntime({
  send: (message) => parentPort.postMessage(message),
  finish: () => {
    if (exitScheduled) {
      return
    }
    exitScheduled = true
    parentPort.off('message', handleMessage)
    setImmediate(() => process.exit(0))
  },
})

function handleMessage(event: Electron.MessageEvent) {
  runtime.handleMessage(event.data)
}

parentPort.on('message', handleMessage)
