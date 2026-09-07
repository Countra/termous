export interface AgentWorkerProcess {
  postMessage(message: unknown): void
  kill(): boolean
  onMessage(listener: (message: unknown) => void): () => void
  onExit(listener: (code: number) => void): () => void
  onSpawn(listener: () => void): () => void
}

export interface AgentWorkerFactory {
  create(): AgentWorkerProcess
}

