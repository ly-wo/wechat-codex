import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParserState, handleStreamLine } from '../codex/provider.js';
import { formatCodexError } from '../codex/errors.js';

test('model version rejection reports an upgrade requirement instead of suggesting session reset', () => {
  const state = createParserState();
  handleStreamLine(JSON.stringify({ type: 'turn.failed', error: { message: JSON.stringify({
    type: 'error', status: 400, error: {
      type: 'invalid_request_error',
      message: "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    },
  }) } }), state, {});
  const message = formatCodexError(state.errorMessage!);
  assert.match(message, /版本过旧/);
  assert.match(message, /更新/);
  assert.doesNotMatch(message, /\/clear/);
});

test('unrecognized errors do not expose raw payloads or credentials', () => {
  const message = formatCodexError('failed: Authorization: Bearer secret-example-token');
  assert.match(message, /未完成/);
  assert.doesNotMatch(message, /secret-example-token|Authorization/);
});
