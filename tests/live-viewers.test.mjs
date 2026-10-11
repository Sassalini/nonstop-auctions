import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countLotViewers, selectLiveLot } from '../src/lib/live-viewers.ts';

const hall = { id: '20000000-0000-0000-0000-000000000701', roomSlug: 'general-room', roomOrder: 7 };
const jewellery = { id: '20000000-0000-0000-0000-000000000101', roomSlug: 'jewellery-room', roomOrder: 1 };

test('presence counts distinct sessions per lot, deduplicating refresh/reconnect/tabs', () => {
  const counts = countLotViewers({
    'anonymous-session-a': [{ lot_id: hall.id }, { lot_id: hall.id }, { lot_id: jewellery.id }],
    'anonymous-session-b': [{ lot_id: hall.id }],
    'invalid-session': [{ lot_id: null }, { lot_id: 'invalid' }, {}],
  });
  assert.deepEqual(counts, { [hall.id]: 2, [jewellery.id]: 1 });
  assert.deepEqual(countLotViewers({}), {});
  assert.deepEqual(countLotViewers({ 'reconnected-a': [{ lot_id: hall.id }] }), { [hall.id]: 1 });
});

test('Live selects actual viewers; ties and zero viewers follow the documented stable rule', () => {
  assert.equal(selectLiveLot([hall, jewellery], { [jewellery.id]: 3, [hall.id]: 2 }).id, jewellery.id);
  assert.equal(selectLiveLot([jewellery, hall], { [jewellery.id]: 2, [hall.id]: 2 }).id, hall.id);
  assert.equal(selectLiveLot([jewellery, hall], {}).id, hall.id);
  const other = { ...hall, roomSlug: 'art-room', roomOrder: 3 };
  assert.equal(selectLiveLot([other, jewellery], {}).id, jewellery.id);
  const tied = { ...jewellery, id: hall.id };
  assert.equal(selectLiveLot([tied, jewellery], {}).id, jewellery.id);
  assert.equal(selectLiveLot([], {}), null);
});

test('departures and automatic lot advancement cannot route to a retired candidate', () => {
  assert.equal(selectLiveLot([jewellery], { [hall.id]: 100, [jewellery.id]: 1 }).id, jewellery.id);
  assert.equal(selectLiveLot([hall, jewellery], { [hall.id]: 1, [jewellery.id]: 4 }).id, jewellery.id);
  assert.equal(selectLiveLot([hall, jewellery], { [hall.id]: 1 }).id, hall.id);
});
