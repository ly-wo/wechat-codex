/** Keep provider payloads and credentials out of user-facing messages. */
export function formatCodexError(error: string): string {
  if (/requires a newer version of Codex/i.test(error)) {
    return '⚠️ 本机 Codex 版本过旧，无法使用当前模型。请更新 Codex 后重启微信桥接；清空会话无法解决此问题。';
  }
  return '⚠️ Codex 本次任务未完成；如已收到部分内容，请以此状态为准。可检查本机日志、Codex 登录和权限配置；会话失效时使用 /clear。';
}
