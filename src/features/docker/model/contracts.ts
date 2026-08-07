import type {
  DockerActionRequest,
  DockerActionResult,
  DockerCapability,
  DockerContainerDetail,
  DockerContainerQuery,
  DockerContainerStats,
  DockerListResult,
  DockerLogsResult,
} from '#entities/docker'

interface DockerRequestOptions {
  signal?: AbortSignal
}

export interface DockerGateway {
  sessionDockerCapability(sessionId: string, options?: DockerRequestOptions): Promise<DockerCapability>
  sessionDockerContainers(
    sessionId: string,
    query?: DockerContainerQuery,
    options?: DockerRequestOptions,
  ): Promise<DockerListResult>
  sessionDockerContainerDetail(
    sessionId: string,
    containerRef: string,
    options?: DockerRequestOptions,
  ): Promise<DockerContainerDetail>
  sessionDockerContainerStats(
    sessionId: string,
    containerRef: string,
    options?: DockerRequestOptions,
  ): Promise<DockerContainerStats>
  sessionDockerContainerLogs(
    sessionId: string,
    containerRef: string,
    tail?: number,
    timestamps?: boolean,
    options?: DockerRequestOptions,
  ): Promise<DockerLogsResult>
  sessionDockerContainerAction(
    sessionId: string,
    containerRef: string,
    input: DockerActionRequest,
    options?: DockerRequestOptions,
  ): Promise<DockerActionResult>
}

export interface DockerSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
}
