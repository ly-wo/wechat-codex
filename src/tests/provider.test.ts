import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createParserState, handleStreamLine, codexQuery, buildCodexArgs } from '../codex/provider.js';
import { TurnRouter, type RoutedMessage } from '../codex/turn-router.js';

const agent = (id: string, text: string) => ({ type: 'item.completed', item: { id, type: 'agent_message', text } });

test('Codex events route progress/final once and exclude reasoning and tool output', () => {
  const state = createParserState();
  const messages: RoutedMessage[] = [];
  const router = new TurnRouter(msg => messages.push(msg));
  const callbacks = { onText: (s: string) => router.onText(s), onTurnEnd: (s: string) => router.onTurnEnd(s) };
  for (const event of [null, {}, { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'private reasoning' } },
    agent('a', '正在检查'),
    { type: 'item.started', item: { id: 'c', type: 'command_execution', command: 'pwd' } },
    { type: 'item.completed', item: { id: 'c', type: 'command_execution', aggregated_output: 'raw tool data' } },
    agent('b', '检查完成'), agent('b', '检查完成'),
    { type: 'turn.completed' }]) handleStreamLine(JSON.stringify(event), state, callbacks);
  handleStreamLine('not json', state, callbacks);
  router.drain();
  assert.equal(state.sessionId, 'thread-1');
  assert.deepEqual(messages, [{ text: '正在检查', role: 'interstitial' }, { text: '检查完成', role: 'final' }]);
  assert.deepEqual(state.textParts, ['正在检查', '检查完成']);
});

test('turn failures preserve errors and resumed identity', () => {
  const state = createParserState('old-id');
  handleStreamLine(JSON.stringify({ type: 'turn.failed', error: { message: 'permission denied' } }), state, {});
  assert.equal(state.sessionId, 'old-id');
  assert.equal(state.errorMessage, 'permission denied');
  assert.equal(state.completed, false);
});

test('CLI arguments support explicit resume, image paths with spaces, sandbox and model defaults', () => {
  const args = buildCodexArgs({ prompt: 'private prompt', cwd: '/workspace', resume: 'thread-id', systemPrompt: '中文\n"quoted"' }, ['/tmp/image one.png']);
  assert.ok(args.indexOf('--sandbox') < args.indexOf('resume'));
  assert.deepEqual(args.slice(-5), ['--image', '/tmp/image one.png', '--', 'thread-id', '-']);
  assert.ok(args.includes('workspace-write'));
  assert.ok(!args.includes('--model'));
  assert.ok(!args.includes('private prompt'));
  assert.ok(!args.some(a => a.includes('dangerously')));
  assert.ok(args.includes('developer_instructions="中文\\n\\"quoted\\""'));
});

// An actual child process exercises JSONL framing, stdin, attachment lifetime and cancellation.
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'wechat-codex-test-'));
  const binary = join(cwd, 'fake codex');
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', s => prompt += s);
process.stdin.on('end', () => {
  const images = args.flatMap((arg, i) => arg === '--image' ? [args[i + 1]] : []);
  fs.writeFileSync('capture.json', JSON.stringify({args, prompt, images: images.map(path => ({path, data: fs.readFileSync(path).toString('base64')}))}));
  const emit = e => process.stdout.write(JSON.stringify(e) + '\\n');
  emit({type:'thread.started',thread_id:'persisted-id'});
  if (prompt === 'hang') { setInterval(() => {}, 1000); return; }
  if (prompt === 'failed') {
    emit({type:'item.completed',item:{id:'a',type:'agent_message',text:'partial'}});
    emit({type:'turn.failed',error:{message:'provider unavailable'}});
    process.exitCode = 1; return;
  }
  if (prompt === 'incomplete') return;
  const reply = JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:'完成'}});
  process.stdout.write(reply.slice(0, 20));
  setTimeout(() => {
    process.stdout.write(reply.slice(20) + '\\n');
    emit({type:'turn.completed'});
  }, 5);
});
`, { mode: 0o700 });
  return { cwd, binary, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test('provider runs and resumes with exact stdin, native images and cleans up temporary images', async () => {
  const f = fixture();
  try {
    const prompt = '你好 `echo never` $(touch never)\n第二行';
    const result = await codexQuery({ prompt, cwd: f.cwd, codexPath: f.binary, timeoutMs: 5000,
      images: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }] });
    assert.deepEqual(result, { text: '完成', sessionId: 'persisted-id', error: undefined, aborted: undefined });
    const capture = JSON.parse(readFileSync(join(f.cwd, 'capture.json'), 'utf8'));
    assert.equal(capture.prompt, prompt);
    assert.equal(capture.images[0].data, 'aW1hZ2U=');
    assert.equal(existsSync(capture.images[0].path), false);
    const resumed = await codexQuery({ prompt: 'continue', cwd: f.cwd, resume: result.sessionId, codexPath: f.binary, timeoutMs: 5000 });
    assert.equal(resumed.error, undefined);
    const resumedArgs = JSON.parse(readFileSync(join(f.cwd, 'capture.json'), 'utf8')).args;
    assert.deepEqual(resumedArgs.slice(-4), ['resume', '--', 'persisted-id', '-']);
    assert.equal(existsSync(join(f.cwd, 'never')), false);
  } finally { f.cleanup(); }
});

test('provider reports errors even after partial text and rejects incomplete streams', async () => {
  const f = fixture();
  try {
    const result = await codexQuery({ prompt: 'failed', cwd: f.cwd, codexPath: f.binary, timeoutMs: 5000 });
    assert.equal(result.text, 'partial');
    assert.equal(result.error, 'provider unavailable');
    const incomplete = await codexQuery({ prompt: 'incomplete', cwd: f.cwd, codexPath: f.binary, timeoutMs: 5000 });
    assert.match(incomplete.error!, /before turn.completed/);
    const missing = await codexQuery({ prompt: 'test', cwd: f.cwd, codexPath: join(f.cwd, 'missing'), timeoutMs: 5000 });
    assert.match(missing.error!, /Failed to spawn Codex/);
  } finally { f.cleanup(); }
});

test('provider handles pre-abort, running cancellation and timeout without leaving a running CLI', async () => {
  const f = fixture();
  try {
    const pre = new AbortController(); pre.abort();
    const skipped = await codexQuery({ prompt: 'hang', cwd: f.cwd, codexPath: f.binary, abortController: pre });
    assert.equal(skipped.aborted, true);
    assert.equal(existsSync(join(f.cwd, 'capture.json')), false);
    const ctrl = new AbortController();
    const running = codexQuery({ prompt: 'hang', cwd: f.cwd, codexPath: f.binary, abortController: ctrl, timeoutMs: 5000 });
    const stop = setTimeout(() => ctrl.abort(), 200);
    const cancelled = await running; clearTimeout(stop);
    assert.equal(cancelled.aborted, true);
    const timed = await codexQuery({ prompt: 'hang', cwd: f.cwd, codexPath: f.binary, timeoutMs: 200 });
    assert.match(timed.error!, /timed out/);
    assert.equal(timed.aborted, undefined);
  } finally { f.cleanup(); }
});
