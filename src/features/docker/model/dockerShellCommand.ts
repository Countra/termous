import type { DockerContainerSummary } from '#entities/docker'

export function buildDockerShellCommand(container: Pick<DockerContainerSummary, 'id' | 'state'>): string | null {
  // 仅使用 Docker 返回的完整 ID，避免同名容器被替换或名称混入 Shell 语法。
  if (container.state !== 'running' || container.id.length !== 64 || !/^[a-f0-9]{64}$/.test(container.id)) return null
  // 在容器内选择 Shell；退出 Bash 时不会再次执行一次 docker exec 或误进入 sh。
  return `docker exec -it '${container.id}' sh -c 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'`
}
