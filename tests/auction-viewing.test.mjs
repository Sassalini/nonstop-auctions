import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAuctionViewingTarget, readAutoPlayPreference } from '../src/lib/auction-viewing.ts';

test('Auto-play defaults on, restores off and tolerates unknown stored values', () => {
  assert.equal(readAutoPlayPreference(null), true);
  assert.equal(readAutoPlayPreference('on'), true);
  assert.equal(readAutoPlayPreference('off'), false);
  assert.equal(readAutoPlayPreference('invalid'), true);
});
test('Auto-play navigation waits for preference hydration and follows only the authoritative current lot', () => {
  const state = { ready: true, enabled: true, displayedLotId: 'old', roomCurrentLotId: 'next', isLotRoute: true };
  assert.equal(getAuctionViewingTarget({ ...state, ready: false }), null);
  assert.equal(getAuctionViewingTarget(state), '/lots/next');
  assert.equal(getAuctionViewingTarget({ ...state, roomCurrentLotId: 'old' }), null);
  assert.equal(getAuctionViewingTarget({ ...state, roomCurrentLotId: undefined }), null);
});
test('Auto-play off pins room/home views but never changes an explicitly viewed lot', () => {
  const state = { ready: true, enabled: false, displayedLotId: 'old', roomCurrentLotId: 'next', isLotRoute: true };
  assert.equal(getAuctionViewingTarget(state), null);
  assert.equal(getAuctionViewingTarget({ ...state, isLotRoute: false }), '/lots/old');
  assert.equal(getAuctionViewingTarget({ ...state, displayedLotId: undefined }), null);
});
