export const localToolNames = new Set(['discover_tools', 'read_skill_resource', 'read_history_image', 'wait_workflow_run'])

export const desktopToolGuide = [
  '已有桌面使用 list → get → attach 建立观察入口；list 不会附着，连接就绪后不重复 connect。后续工具按结果导航在下一轮加载，调用返回的实际 name。',
  '申请控制使用 control.acquire，归还使用 control.release；grant_id 只能取本轮 acquire 返回值，不能填 none 等占位值。缺少准确操作先 discover_tools。准备运行 workflow 时先归还自己的直接控制，脚本会申请独立授权；人工收回后不自动接管。',
  '新快照用 captures.create，release 仅释放旧快照；缺少 create 先发现，不能拿 release 代替。截图坐标使用 image_view 展示像素，不手算缩放；固定帧局部放大用 captures.view。',
  '模板每边须为 8..512 原始像素；选择紧凑稳定特征，preview → match → confirm。coordinate_space 仅 image 或 desktop，推荐 image。',
  '打开应用、已知 URL 优先快捷键和文本输入，不为每步制作模板。固定像素模板不能保证识别“今天”，不得默认列表首条就是今天。',
  '输入结果不确定时停止，不重放。保存脚本后固定版本运行，使用 wait_workflow_run 等到终态；本轮结束会清理所属运行。',
].join('\n')
