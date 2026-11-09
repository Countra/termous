export async function shutdownAgentServices(workers: { shutdown(): Promise<void> }, integrations: { close(): Promise<void> }) {
  const errors: unknown[] = []
  // 先停止请求生产方；任一清理失败仍须尝试另一方，避免遗留 Worker 或外部进程。
  try { await workers.shutdown() } catch (error) { errors.push(error) }
  try { await integrations.close() } catch (error) { errors.push(error) }
  if (errors.length) throw Object.assign(new Error('AGENT_RUNTIME_SHUTDOWN_FAILED'), { causes: errors })
}
