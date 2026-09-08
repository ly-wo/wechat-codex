import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { logger } from '../logger.js';

export type SandboxMode = 'read-only' | 'workspace-write';

export interface QueryOptions {
  prompt: string;
  cwd: string;
  resume?: string;
  model?: string;
  systemPrompt?: string;
  codexPath?: string;
  sandbox?: SandboxMode;
  timeoutMs?: number;
  images?: Array<{
    type: 'image';
    source: { type: 'base64'; media_type: string; data: string };
  }>;
  onText?: (text: string) => void;
  /** Adapter for TurnRouter: progress ('tool_use') or final ('end_turn'). */
  onTurnEnd?: (reason: string) => void;
  abortController?: AbortController;
}

export interface QueryResult {
  text: string;
  sessionId: string;
  error?: string;
  aborted?: boolean;
}

export interface StreamParserState {
  sessionId: string;
  textParts: string[];
  pendingText?: string;
  seenItems: Set<string>;
  completed: boolean;
  errorMessage?: string;
}

export type StreamParserCallbacks = Pick<QueryOptions, 'onText' | 'onTurnEnd'>;

export function createParserState(sessionId = ''): StreamParserState {
  return { sessionId, textParts: [], seenItems: new Set(), completed: false };
}

export function flushParser(state: StreamParserState, callbacks: StreamParserCallbacks, reason: string): void {
  if (state.pendingText) {
    callbacks.onText?.(state.pendingText);
    callbacks.onTurnEnd?.(reason);
    state.pendingText = undefined;
  }
}

/** Codex exec emits JSONL items, not Claude content_block_delta events. */
export function handleStreamLine(line: string, state: StreamParserState, callbacks: StreamParserCallbacks): void {
  let event: any;
  try { event = JSON.parse(line); } catch { return; }
  if (!event || typeof event !== 'object') return;
  switch (event.type) {
    case 'thread.started':
      if (typeof event.thread_id === 'string') state.sessionId = event.thread_id;
      break;
    case 'item.started':
    case 'item.completed': {
      const item = event.item;
      if (!item || typeof item.type !== 'string') break;
      if (item.type === 'agent_message' && event.type === 'item.completed' && typeof item.text === 'string') {
        if (typeof item.id === 'string' && state.seenItems.has(item.id)) break;
        if (typeof item.id === 'string') state.seenItems.add(item.id);
        flushParser(state, callbacks, 'tool_use');
        if (item.text.trim()) {
          state.textParts.push(item.text);
          state.pendingText = item.text;
          // Newer CLI versions may explicitly identify commentary/final messages.
          if (item.phase === 'commentary') flushParser(state, callbacks, 'tool_use');
        }
      } else if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(item.type)) {
        flushParser(state, callbacks, 'tool_use');
      }
      // Reasoning and raw command/tool output are never sent to WeChat.
      break;
    }
    case 'turn.completed':
      state.completed = true;
      state.errorMessage = undefined; // A transient reconnect error may have recovered.
      flushParser(state, callbacks, 'end_turn');
      break;
    case 'turn.failed':
      state.errorMessage = event.error?.message || 'Codex turn failed';
      flushParser(state, callbacks, 'tool_use');
      break;
    case 'error':
      state.errorMessage = typeof event.message === 'string' ? event.message : 'Codex stream error';
      break;
  }
}

export function buildCodexArgs(options: QueryOptions, imagePaths: string[] = []): string[] {
  // Put common exec settings before resume: resume does not accept --sandbox or --cd.
  const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never',
    '--sandbox', options.sandbox ?? 'workspace-write', '-c', 'approval_policy="never"'];
  if (options.model) args.push('--model', options.model);
  if (options.systemPrompt) args.push('-c', `developer_instructions=${JSON.stringify(options.systemPrompt)}`);
  if (options.resume) args.push('resume');
  for (const path of imagePaths) args.push('--image', path);
  // -- ends the variadic --image option as well as protecting positional values.
  args.push('--');
  if (options.resume) args.push(options.resume);
  args.push('-');
  return args;
}

/** Run exactly once; never replay a failed coding task in a fresh thread automatically. */
export async function codexQuery(options: QueryOptions): Promise<QueryResult> {
  const signal = options.abortController?.signal;
  if (signal?.aborted) return { text: '', sessionId: options.resume ?? '', aborted: true };
  const state = createParserState(options.resume);
  const codexPath = options.codexPath || process.env.CODEX_BIN || 'codex';
  let imageDir: string | undefined;
  try {
    const imagePaths: string[] = [];
    if (options.images?.length) {
      imageDir = mkdtempSync(join(tmpdir(), 'wechat-codex-images-'));
      const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
      for (const [index, img] of options.images.entries()) {
        const ext = extensions[img.source.media_type];
        if (!ext) throw new Error(`Unsupported image type: ${img.source.media_type}`);
        const path = join(imageDir, `${index}.${ext}`);
        writeFileSync(path, Buffer.from(img.source.data, 'base64'), { mode: 0o600 });
        imagePaths.push(path);
      }
    }
    logger.info('Starting Codex CLI query', { cwd: options.cwd, codexPath, model: options.model, resume: !!options.resume });
    return await new Promise<QueryResult>((resolve) => {
      const child = spawn(codexPath, buildCodexArgs(options, imagePaths), {
        cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', env: { ...process.env },
      });
      let stderr = '';
      let settled = false;
      let stopped = false;
      let stopError: string | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (sig: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch { /* Process already exited. */ }
      };
      const stop = (error?: string) => {
        if (stopped || settled) return;
        stopped = true;
        stopError = error;
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 2_000);
      };
      const onAbort = () => stop();
      const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
      const timeout = setTimeout(() => stop(`Codex query timed out after ${timeoutMs} ms`), timeoutMs);
      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        // Also terminate remaining children before releasing the serial message queue.
        if (stopped) kill('SIGKILL');
        if (!stopped) flushParser(state, options, state.completed ? 'end_turn' : 'tool_use');
        resolve({ text: state.textParts.join('\n\n').trim(), sessionId: state.sessionId,
          error: stopError || error, aborted: signal?.aborted || undefined });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => { if (!stopped) handleStreamLine(line, state, options); });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-16_384); });
      // Early process exit can close stdin; handle EPIPE without crashing the daemon.
      child.stdin.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(error.message); });
      child.on('error', (error) => finish(`Failed to spawn Codex (${codexPath}): ${error.message}`));
      child.on('close', (code, exitSignal) => {
        const error = state.errorMessage || (code !== 0
          ? stderr.trim() || `Codex exited with ${exitSignal || code}`
          : !state.completed ? 'Codex exited before turn.completed' : undefined);
        logger.info('Codex CLI query completed', { sessionId: state.sessionId, hasError: !!error || !!stopError });
        finish(error);
      });
      if (signal?.aborted) onAbort();
      else child.stdin.end(options.prompt);
    });
  } catch (error) {
    return { text: '', sessionId: state.sessionId, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (imageDir) rmSync(imageDir, { recursive: true, force: true });
  }
}
