import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('peak ranking rejects uniform activity and selects event boundaries', () => {
  const python = process.platform === 'win32' ? path.resolve('tools/python/python.exe') : 'python3';
  const result = spawnSync(python, ['-c', "import sys; sys.path.insert(0, 'ai'); import unittest; unittest.main(module='test_highlights', verbosity=2)"], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
