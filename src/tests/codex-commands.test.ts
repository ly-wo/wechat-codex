import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanAllSkills } from '../codex/skill-scanner.js';
import { routeCommand, type CommandContext } from '../commands/router.js';
import { createSessionStore, type Session } from '../session.js';
import { saveConfig, loadConfig } from '../config.js';
import { saveAccount, loadLatestAccount } from '../wechat/accounts.js';
import { DATA_DIR } from '../constants.js';

test('project, symlinked user and versioned plugin skills are discoverable with project precedence', () => {
  const home = mkdtempSync(join(tmpdir(), 'wechat-codex-skills-'));
  const cwd = join(home, 'project');
  const codexHome = join(home, 'codex-home');
  function skill(path: string, name: string) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: >\n  first line\n  second line\n---\n`); }
  try {
    skill(join(cwd, '.agents/skills/demo'), 'demo');
    skill(join(home, '.agents/skills/demo'), 'demo');
    skill(join(home, 'external'), 'linked');
    symlinkSync(join(home, 'external'), join(home, '.agents/skills/link'));
    skill(join(codexHome, 'plugins/cache/vendor/plugin/1.0/skills/plugin-skill'), 'plugin-skill');
    const skills = scanAllSkills(cwd, home, codexHome);
    assert.equal(skills.length, 3);
    assert.equal(skills.find(s => s.name === 'demo')?.path, join(cwd, '.agents/skills/demo'));
    assert.equal(skills[0].description, 'first line second line');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('config, account and session storage share an isolated data directory; clear and cwd reset identity', () => {
  // The test runner supplies a temporary data root, never the user's real bridge data.
  assert.ok(process.env.WECHAT_CODEX_DATA_DIR, 'Run through npm test');
  const cwd = join(DATA_DIR, 'workspace');
  mkdirSync(cwd, { recursive: true });
  saveConfig({ workingDirectory: cwd, model: 'configured-model', sandbox: 'read-only', timeoutMs: 3000 });
  assert.equal(loadConfig().sandbox, 'read-only');
  saveAccount({ accountId: 'test', userId: 'owner', botToken: 'fake-token', baseUrl: 'https://example.invalid', createdAt: '' });
  assert.equal(loadLatestAccount()?.userId, 'owner');
  const store = createSessionStore();
  const session: Session = store.load('test', loadConfig());
  assert.equal(session.workingDirectory, cwd);
  session.sdkSessionId = 'old-id';
  session.model = 'chosen-model';
  const ctx: CommandContext = { accountId: 'test', session, text: '/clear',
    updateSession: partial => { Object.assign(session, partial); store.save('test', session); },
    clearSession: () => store.clear('test', session) };
  routeCommand(ctx);
  assert.equal(session.sdkSessionId, undefined);
  assert.equal(session.model, 'chosen-model');
  session.sdkSessionId = 'next-id';
  const next = join(cwd, 'directory with spaces'); mkdirSync(next);
  routeCommand({ ...ctx, text: `/cwd ${next}` });
  assert.equal(session.workingDirectory, next);
  assert.equal(store.load('test').sdkSessionId, undefined);
  routeCommand({ ...ctx, text: '/cwd /missing-wechat-codex-directory' });
  assert.equal(session.workingDirectory, next);
  assert.match(routeCommand({ ...ctx, text: '/model' }).reply!, /chosen-model/);
  routeCommand({ ...ctx, text: '/reset' });
  assert.equal(store.load('test').workingDirectory, cwd);
  assert.equal(store.load('test').model, undefined);
  writeFileSync(join(DATA_DIR, 'config.json'), '{invalid');
  assert.throws(() => loadConfig(), /无法读取配置/);
  assert.equal(readFileSync(join(DATA_DIR, 'config.json'), 'utf8'), '{invalid');
});
