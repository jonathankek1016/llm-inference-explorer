import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRequestError } from '../src/request-errors.ts';

test('request-specific error sanitization keeps useful diagnostics, never reflected secrets or image payloads', () => {
  const key = 'fake-key-for-regression-only';
  assert.equal(
    safeRequestError(new Error(`401 invalid credential ${key}; retry ${key}`), key),
    '401 invalid credential [redacted]; retry [redacted]',
  );
  assert.equal(safeRequestError(new Error('model not found'), ''), 'model not found');
  assert.equal(safeRequestError(null, key), 'Request failed');
  const safe = safeRequestError(
    new Error(`data:image/png;base64,ABC ABC ${key}`),
    key,
    'data:image/png;base64,ABC',
  );
  assert.ok(!safe.includes('ABC'));
  assert.ok(!safe.includes(key));
  assert.equal(safeRequestError(new Error('x'.repeat(2100)), '').length, 2000);
});
