import assert from 'node:assert/strict';
import test from 'node:test';
import { getDeadlineSeconds, getClockOffsetMs, parseBidAmount } from '../src/lib/auction-clock.ts';

test('deadline displays account for elapsed time, bid resets, and zero without deciding results', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  assert.equal(getDeadlineSeconds('2026-10-03T12:00:05Z', now + 2300), 3);
  assert.equal(getDeadlineSeconds('2026-10-03T12:00:07Z', now + 2300), 5);
  assert.equal(getDeadlineSeconds('2026-10-03T12:00:05Z', now + 6000), 0);
  assert.equal(getDeadlineSeconds('invalid', now), 0);
});
test('clock synchronization corrects browser clock skew and estimates network midpoint', () => {
  const server = Date.parse('2026-10-03T12:00:00Z');
  const offset = getClockOffsetMs('2026-10-03T12:00:00Z', server + 60000, server + 60200);
  assert.equal(offset, -60100);
  assert.equal(getDeadlineSeconds('2026-10-03T12:00:05Z', server + 60100 + offset), 5);
});
test('bid input rejects negative, malformed, non-finite and fractional-penny amounts', () => {
  for (const value of ['-100', 'NaN', 'Infinity', '100GBP', '0', '12.001', '1,,000', '1000000000000']) assert.ok(Number.isNaN(parseBidAmount(value)), value);
  assert.equal(parseBidAmount('1,250.50'), 1250.5);
  assert.equal(parseBidAmount('1250'), 1250);
});
