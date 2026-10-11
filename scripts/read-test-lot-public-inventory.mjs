// Read-only GETs using the existing publishable/anon key. No RPCs, writes or Auth
// admin calls. Private records require the separate owner SQL inventory.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const source = await readFile('.env.local', 'utf8');
const envValue = name => {
  const value = source.match(new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return value.replace(/^(["'])(.*)\1$/, '$2');
};
const url = envValue('NEXT_PUBLIC_SUPABASE_URL');
const key = envValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (!url || !key) throw new Error('Public Supabase configuration is unavailable. Use the owner SQL inventory.');
let role = '';
try { role = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url')).role; } catch { /* New publishable format. */ }
if (!key.startsWith('sb_publishable_') && role !== 'anon') throw new Error('Inventory accepts only a publishable/anon key.');
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function readAll(table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(offset, offset + 999);
    if (error) throw new Error(`Read-only ${table} inventory failed (${error.code ?? 'network error'}).`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const [rooms, lots] = await Promise.all([
  readAll('auction_rooms', 'id,slug,name,display_order'),
  readAll('lots', 'id,room_id,seller_id,title,status,bid_count,current_bid,highest_bidder_id,winning_bid,next_eligible_at'),
]);
const statuses = {};
for (const lot of lots) statuses[lot.status] = (statuses[lot.status] ?? 0) + 1;
const report = {
  observed_at: new Date().toISOString(),
  scope: 'Public catalogue only. RLS hides drafts, inactive rooms, bid records, watchlists, notifications and Auth identity. This report cannot authorize deletion.',
  rooms: rooms.sort((a,b) => a.display_order-b.display_order).map(room => ({
    name: room.name, slug: room.slug, count: lots.filter(lot => lot.room_id === room.id).length,
    unsold_returned: lots.filter(lot => lot.room_id === room.id && lot.status === 'UNSOLD').length,
  })),
  statuses, total: lots.length,
  seed_marker_lots: lots.filter(lot => lot.id.startsWith('20000000-0000-0000-0000-') && lot.seller_id === '00000000-0000-0000-0000-000000000101').length,
  lots_with_bid_activity: lots.filter(lot => lot.bid_count > 0).length,
  lots_with_winner_or_result: lots.filter(lot => lot.highest_bidder_id || lot.winning_bid !== null).length,
  other_seller_lots: lots.filter(lot => lot.seller_id !== '00000000-0000-0000-0000-000000000101').length,
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/test-lot-public-inventory.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
