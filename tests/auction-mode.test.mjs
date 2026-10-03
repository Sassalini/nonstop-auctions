import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuctionDataMode } from '../src/lib/auction-mode.ts';

test('configured Supabase always wins over a demo flag', () => {
  assert.equal(getAuctionDataMode({ supabaseUrl: 'https://example.supabase.co', supabaseKey: 'public-key', demoMode: 'true' }), 'supabase');
});
test('partial or missing production configuration never silently loads mock auctions', () => {
  assert.throws(() => getAuctionDataMode({}), /not configured/);
  assert.throws(() => getAuctionDataMode({ supabaseUrl: 'https://example.supabase.co', demoMode: 'true' }), /Both Supabase/);
});
test('demo auctions require explicit opt-in and no Supabase connection', () => {
  assert.equal(getAuctionDataMode({ demoMode: 'true' }), 'demo');
});
