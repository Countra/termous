import type {
  DockerActionRequest,
  DockerActionResult,
  DockerCapability,
  DockerContainerDetail,
  DockerContainerQuery,
  DockerContainerStats,
  DockerListResult,
  DockerLogsResult,
  DockerResourceKind, DockerResourceQuery, DockerResourceList, DockerResourceDetail,
  DockerResourceCreateRequest, DockerResourceActionRequest, DockerResourceActionResult,
} from '#entities/docker'

interface DockerRequestOptions {
  signal?: AbortSignal
}

export interface DockerGateway {
  sessionDockerResources(sessionId: string, kind: DockerResourceKind, query?: DockerResourceQuery, options?: DockerRequestOptions): Promise<DockerResourceList>
  sessionDockerResourceDetail(sessionId: string, kind: DockerResourceKind, ref: string, options?: DockerRequestOptions): Promise<DockerResourceDetail>
  sessionDockerResourceCreate(sessionId: string, kind: 'volumes' | 'networks', input: DockerResourceCreateRequest): Promise<DockerResourceActionResult>
  sessionDockerResourceAction(sessionId: string, kind: DockerResourceKind, ref: string, input: DockerResourceActionRequest): Promise<DockerResourceActionResult>
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
