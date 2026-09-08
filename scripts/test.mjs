import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dataDir = mkdtempSync(join(tmpdir(), 'wechat-codex-tests-'));
try {
  const tests = readdirSync('dist/tests').filter(f => f.endsWith('.test.js')).map(f => join('dist/tests', f));
  const result = spawnSync(process.execPath, ['--test', ...tests], {
    stdio: 'inherit', env: { ...process.env, WECHAT_CODEX_DATA_DIR: dataDir },
  });
  process.exitCode = result.status ?? 1;
} finally { rmSync(dataDir, { recursive: true, force: true }); }
