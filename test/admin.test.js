// Разбор ADMIN_IDS: node --test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_IDS = ' 111, 222;333  abc -5 0 12.5 ';
const { cfg, isAdmin } = await import('../src/config.js');

test('ADMIN_IDS: берём только целые положительные id', () => {
  assert.deepEqual(cfg.adminIds, [111, 222, 333]);
});

test('isAdmin: проверяет и числа, и строки; чужие id — нет', () => {
  assert.equal(isAdmin(111), true);
  assert.equal(isAdmin('222'), true);
  assert.equal(isAdmin(444), false);
  assert.equal(isAdmin(undefined), false);
  assert.equal(isAdmin(NaN), false);
  assert.equal(isAdmin(0), false);
});
