// 发送间隔与失联期限分开；托管 Core 的环境参数和前端判定必须使用同一窗口。
export const coreHeartbeatIntervalMs = 10_000
export const coreHeartbeatTimeoutMs = 60_000
export const coreRequestTimeoutMs = 5_000

// 普通启动和数据库完成后的服务初始化分别使用固定预算，心跳不能续期。
export const coreReadyTimeoutMs = 120_000
export const coreStartupSilenceMs = 60_000
