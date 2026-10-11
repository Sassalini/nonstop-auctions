// Test-only local Supabase HTTP fixture. Never uses .env.local or a hosted database.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const room = { id: '10000000-0000-0000-0000-000000000007', slug: 'general-room', name: 'The Grand Hall',
  description: 'For the more special and unique spectacles.', image_url: '/images/auction-house-background.png', display_order: 7, is_active: true, created_at: new Date().toISOString() };
const jewellery = { ...room, id: '10000000-0000-0000-0000-000000000001', slug: 'jewellery-room', name: 'The Jewellery Room', display_order: 1 };
let rooms = [room];
let accountsEnabled = false;
const accountA = '00000000-0000-0000-0000-000000000102';
const accountB = '00000000-0000-0000-0000-000000000103';
let notifications = [];
let watchlist = [];
const user = id => ({ id, email: `${id === accountA ? 'one' : 'two'}@example.test`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const accessToken = id => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture-signature`;
function requestAccount(req) {
  try { const id = JSON.parse(Buffer.from(req.headers.authorization?.split('.')[1] ?? '', 'base64url').toString()).sub; return [accountA,accountB].includes(id) ? id : null; } catch { return null; }
}
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
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  const reply = (data, code = 200) => { res.writeHead(code); res.end(JSON.stringify(data)); };
  const body = async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };
  if (url.pathname === '/_test/state') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const state = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (state.mode === 'empty') { lots = []; images = []; rooms = [room]; accountsEnabled = false; notifications = []; watchlist = []; }
    if (state.mode === 'preview' || state.mode === 'active') {
      lots = [createLot(state.mode === 'active' ? 'ACTIVE_BIDDING' : 'PREVIEW')];
      images = [{ id: 'image-one', lot_id: id, image_url: '/images/auction-house-background.png?view=one', sort_order: 0 }];
    }
    if (state.resetBid && lots[0]) { lots[0].ends_at = new Date(Date.now() + 5000).toISOString(); lots[0].bid_count++; lots[0].current_bid += 10; }
    if (state.nextLot && lots[0]) {
      lots[0] = { ...createLot(), id: '20000000-0000-0000-0000-000000000702', title: 'Next release test item' };
      images = [{ id: 'image-two', lot_id: lots[0].id, image_url: '/images/auction-house-background.png?view=two', sort_order: 0 }];
    }
    if (state.mode === 'global') {
      rooms = [jewellery, room];
      lots = [
        { ...createLot('FIRST_BID_WINDOW'), ends_at: new Date(Date.now()+60000).toISOString() },
        { ...createLot('FIRST_BID_WINDOW'), id: '20000000-0000-0000-0000-000000000101', room_id: jewellery.id, title: 'Jewellery fixture lot', ends_at: new Date(Date.now()+60000).toISOString() },
        { ...createLot('WAITING'), id: '20000000-0000-0000-0000-000000000702', title: 'Grand Hall queued lot', queue_position: 2 },
      ];
      images = lots.map(lot => ({ id: lot.id, lot_id: lot.id, image_url: '/images/auction-house-background.png', sort_order: 0 }));
      accountsEnabled = true;
      notifications = [accountA, accountB].map((account,index) => ({ id: `40000000-0000-0000-0000-00000000010${index+1}`, user_id: account, lot_id: id, kind: index ? 'WATCHED_SOLD' : 'WON', lot_title: index ? 'Private account two item' : 'Private account one item', auction_run: new Date().toISOString(), created_at: new Date().toISOString(), read_at: null }));
      watchlist = [accountA, accountB].map((account,index) => ({ id: `50000000-0000-0000-0000-00000000010${index+1}`, user_id: account, lot_id: id }));
    }
    if (state.mode === 'sequence') {
      rooms = [room]; accountsEnabled = false; notifications = []; watchlist = [];
      lots = [
        { ...createLot(state.status ?? 'ACTIVE_BIDDING'), title: 'Sequence current lot', highest_bidder_id: state.status === 'FIRST_BID_WINDOW' ? null : accountB, winning_bid: null, sold_at: null, unsold_at: null, ends_at: new Date(Date.now()+60000).toISOString() },
        { ...createLot('WAITING'), id: '20000000-0000-0000-0000-000000000702', title: 'Next sequence lot', queue_position: 2, winning_bid: null, highest_bidder_id: null, sold_at: null, unsold_at: null },
        { ...createLot('WAITING'), id: '20000000-0000-0000-0000-000000000703', title: 'Third sequence lot', queue_position: 3, winning_bid: null, highest_bidder_id: null, sold_at: null, unsold_at: null },
      ];
      images = lots.map(lot => ({ id: lot.id, lot_id: lot.id, image_url: '/images/auction-house-background.png', sort_order: 0 }));
    }
    if (state.sequenceResult) {
      const finished = lots.find(lot => lot.id === id);
      const next = lots.find(lot => lot.id === '20000000-0000-0000-0000-000000000702');
      finished.status = state.sequenceResult; finished.ends_at = new Date().toISOString();
      if (finished.status === 'SOLD') {
        finished.current_bid = 250; finished.winning_bid = 250; finished.bid_count = 2; finished.highest_bidder_id = accountB; finished.sold_at = new Date().toISOString();
      } else {
        finished.current_bid = finished.starting_bid; finished.winning_bid = null; finished.highest_bidder_id = null; finished.bid_count = 0;
        finished.unsold_at = new Date().toISOString(); finished.next_eligible_at = new Date(Date.now()+7*24*60*60*1000).toISOString(); finished.queue_position = 4;
      }
      next.status = 'PREVIEW'; next.preview_starts_at = new Date().toISOString(); next.ends_at = new Date(Date.now()+30000).toISOString();
    }
    if (state.hallEmpty) lots = lots.filter(lot => lot.room_id !== room.id);
    if (state.retireHall) { const hallLot = lots.find(lot => lot.id === id); if (hallLot) hallLot.status = 'SOLD'; }
    if (state.notification) notifications.push({ ...state.notification, auction_run: new Date().toISOString(), created_at: new Date().toISOString(), read_at: null });
    return reply({ ok: true });
  }
  if (url.pathname.endsWith('/rpc/auction_server_time')) return reply(new Date().toISOString());
  if (url.pathname.endsWith('/rpc/advance_room_lifecycle')) { const data = await body(); return reply(lots.find(lot => lot.room_id === data.p_room_id) ?? null); }
  if (url.pathname.endsWith('/rpc/lot_watchlist_count')) { const data = await body(); return reply(watchlist.filter(item => item.lot_id === data.p_lot_id).length); }
  if (accountsEnabled && url.pathname === '/auth/v1/token') {
    const data = await body(); const account = data.email === 'one@example.test' ? accountA : data.email === 'two@example.test' ? accountB : null;
    if (account) return reply({ access_token: accessToken(account), refresh_token: `fixture-${account}`, token_type: 'bearer', expires_in: 3600, user: user(account) });
  }
  if (accountsEnabled && url.pathname === '/auth/v1/user') { const account = requestAccount(req); if (account) return reply(user(account)); }
  if (accountsEnabled && url.pathname === '/auth/v1/logout') return reply({});
  if (url.pathname.startsWith('/auth/v1/')) return reply({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
  const account = requestAccount(req);
  let rows = url.pathname.endsWith('/auction_rooms') ? rooms
    : url.pathname.endsWith('/lots') ? lots : url.pathname.endsWith('/lot_images') ? images
    : url.pathname.endsWith('/notifications') ? notifications.filter(item => item.user_id === account)
    : url.pathname.endsWith('/watchlist') ? watchlist.filter(item => item.user_id === account) : [];
  for (const [column, filter] of url.searchParams) {
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[column]) === filter.slice(3));
    if (filter.startsWith('neq.')) rows = rows.filter(row => String(row[column]) !== filter.slice(4));
    if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[column])));
    if (filter === 'is.null') rows = rows.filter(row => row[column] === null);
  }
  if (url.pathname.endsWith('/notifications') && req.method === 'PATCH') {
    const data = await body();
    if (Object.keys(data).some(key => key !== 'read_at')) return reply({ message: 'permission denied' }, 403);
    rows.forEach(row => { row.read_at = data.read_at; }); return reply(null);
  }
  if (url.pathname.endsWith('/watchlist') && req.method === 'DELETE') {
    watchlist = watchlist.filter(item => !rows.includes(item)); return reply(null);
  }
  if (url.pathname.endsWith('/watchlist') && req.method === 'POST') {
    const data = await body();
    if (!account || data.user_id !== account) return reply({ message: 'permission denied' }, 403);
    if (!watchlist.some(item => item.user_id === account && item.lot_id === data.lot_id)) watchlist.push({ ...data, id: `fixture-${Date.now()}` });
    return reply(null);
  }
  if (req.method === 'HEAD') { res.setHeader('Content-Range', `0-0/${rows.length}`); return reply(null); }
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
