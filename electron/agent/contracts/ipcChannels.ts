export const agentRuntimeIPCChannels = {
  getStatus: 'agent-runtime:get-status',
  start: 'agent-runtime:start',
  stop: 'agent-runtime:stop',
  steer: 'agent-runtime:steer',
  wake: 'agent-runtime:wake',
  steerQueuedTurn: 'agent-runtime:steer-queued-turn',
  status: 'agent-runtime:status',
} as const
