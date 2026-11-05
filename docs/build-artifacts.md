# 构建产物归档

CI／Release 可选将本次安装包、构建日志和提交摘要归档到 MinIO。默认关闭，GitHub Release 和自动更新方式不变。

- 手动运行工作流时勾选 `upload`；或将仓库变量 `TERMOUS_UPLOAD_ARTIFACTS` 设为 `true`。
- 仓库 Secrets 配置 `TERMOUS_MINIO_ACCESS_KEY`、`TERMOUS_MINIO_SECRET_KEY`，临时凭据可再配置 `TERMOUS_MINIO_SESSION_TOKEN`。
- 位置沿用 buildtools 的 `upload` 配置，默认地址 `https://s3.drive.k8x.net/`、桶 `termous-build`、前缀 `desktop`。

三平台共用同一工作流身份和 UTC 日期目录，各平台单独归档。构建失败时只归档本次失败摘要及日志；取消工作流或没有生成本次报告时不上传。只有独立归档步骤获得 MinIO 凭据，正常构建步骤始终禁用自动上传。

上传失败会使任务失败，Release 保持 Draft。本地文件保留，可使用 buildtools 的独立 `upload --config ... --report ...` 命令补传，不重复构建，也不扫描最近一次运行。文件变化或被清理后不能补传旧报告。

完整配置、权限、目录和故障处理见 [buildtools 归档说明](https://github.com/Countra/termous-buildtools/blob/main/docs/artifact-archive.md)。
