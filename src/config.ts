import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR, DEFAULT_WORKING_DIR } from './constants.js';
import { saveJson } from './store.js';
import type { SandboxMode } from './codex/provider.js';

export interface Config {
  workingDirectory: string;
  model?: string;
  systemPrompt?: string;
  codexPath?: string;
  sandbox?: SandboxMode;
  timeoutMs?: number;
}
const CONFIG_PATH = join(DATA_DIR, 'config.json');

export function loadConfig(): Config {
  let parsed: Partial<Config> = {};
  try { parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`无法读取配置 ${CONFIG_PATH}: ${error}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('config.json 必须是对象');
  for (const key of ['workingDirectory', 'model', 'systemPrompt', 'codexPath'] as const) {
    if (parsed[key] !== undefined && typeof parsed[key] !== 'string') throw new Error(`配置 ${key} 必须是字符串`);
  }
  if (parsed.sandbox !== undefined && !['read-only', 'workspace-write'].includes(parsed.sandbox)) {
    throw new Error('sandbox 必须是 read-only 或 workspace-write');
  }
  if (parsed.timeoutMs !== undefined && (!Number.isSafeInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0 || parsed.timeoutMs > 2_147_483_647)) {
    throw new Error('timeoutMs 必须是 1 到 2147483647 之间的整数');
  }
  const config: Config = { ...parsed, workingDirectory: resolve((parsed.workingDirectory || DEFAULT_WORKING_DIR).replace(/^~(?=\/|$)/, homedir())) };
  mkdirSync(config.workingDirectory, { recursive: true });
  return config;
}

export function saveConfig(config: Config): void {
  saveJson(CONFIG_PATH, config);
}
