// Test-only local Supabase HTTP fixture. Never uses .env.local or a hosted database.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const room = { id: '10000000-0000-0000-0000-000000000007', slug: 'general-room', name: 'The General Room',
  description: 'Distinctive finds for every collection.', image_url: '/images/auction-house-background.png', display_order: 1, is_active: true, created_at: new Date().toISOString() };
const id = '20000000-0000-0000-0000-000000000701';
let lots = [];
let images = [];
const createLot = (status = 'PREVIEW') => ({ id, room_id: room.id, seller_id: '00000000-0000-0000-0000-000000000101',
  title: 'Release test catalogue item', description: 'Catalogue description', condition_report: 'Condition report', shipping_info: 'Collection information',
  starting_bid: 100, current_bid: 100, minimum_increment: 10, bid_count: status === 'ACTIVE_BIDDING' ? 1 : 0,
  status, preview_duration_seconds: 30, first_bid_duration_seconds: 30, bid_extension_seconds: 5, requeue_delay_days: 7,
  ends_at: new Date(Date.now() + (status === 'ACTIVE_BIDDING' ? 5000 : 30000)).toISOString(), next_eligible_at: new Date().toISOString(),
  queue_position: 1, is_premium: false, created_at: new Date().toISOString() });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:54399');
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3005');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'apikey,authorization,content-type,x-client-info,prefer');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  const reply = (data, code = 200) => { res.writeHead(code); res.end(JSON.stringify(data)); };
  if (url.pathname === '/_test/state') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const state = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (state.mode === 'empty') { lots = []; images = []; }
    if (state.mode === 'preview' || state.mode === 'active') {
      lots = [createLot(state.mode === 'active' ? 'ACTIVE_BIDDING' : 'PREVIEW')];
      images = [{ id: 'image-one', lot_id: id, image_url: '/images/auction-house-background.png?view=one', sort_order: 0 }];
    }
    if (state.resetBid && lots[0]) { lots[0].ends_at = new Date(Date.now() + 5000).toISOString(); lots[0].bid_count++; lots[0].current_bid += 10; }
    if (state.nextLot && lots[0]) {
      lots[0] = { ...createLot(), id: '20000000-0000-0000-0000-000000000702', title: 'Next release test item' };
      images = [{ id: 'image-two', lot_id: lots[0].id, image_url: '/images/auction-house-background.png?view=two', sort_order: 0 }];
    }
    return reply({ ok: true });
  }
  if (url.pathname.endsWith('/rpc/auction_server_time')) return reply(new Date().toISOString());
  if (url.pathname.endsWith('/rpc/advance_room_lifecycle')) return reply(lots[0] ?? null);
  if (url.pathname.startsWith('/auth/v1/')) return reply({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
  let rows = url.pathname.endsWith('/auction_rooms') ? [room]
    : url.pathname.endsWith('/lots') ? lots : url.pathname.endsWith('/lot_images') ? images : [];
  for (const [column, filter] of url.searchParams) {
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[column]) === filter.slice(3));
    if (filter.startsWith('neq.')) rows = rows.filter(row => String(row[column]) !== filter.slice(4));
    if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[column])));
  }
  return reply(rows);
});
server.listen(54399, '127.0.0.1');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3005'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_browser_test', AUCTION_DEMO_MODE: 'true' },
});
const stop = () => { child.kill(); server.close(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.on('exit', code => { server.close(); process.exitCode = code ?? 0; });
