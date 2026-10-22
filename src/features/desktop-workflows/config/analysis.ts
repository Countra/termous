// 源码联调为 IDE 断点预留 15 分钟；正式请求仍沿用 200 秒期限。
export const analysisRequestTimeout = import.meta.env?.DEV === true ? 910_000 : 200_000
