import assert from 'node:assert/strict';
import test from 'node:test';
import { safeReturnPath } from '../src/lib/auth-navigation.ts';

test('authentication redirects stay on this site', () => {
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2f/evil.example', '/%5cevil.example', '/%0aevil', '/%09/evil.example', '/\t/evil.example', '/%']) assert.equal(safeReturnPath(value), '/my-auctions', value);
  assert.equal(safeReturnPath('/rooms/general-room'), '/rooms/general-room');
});
