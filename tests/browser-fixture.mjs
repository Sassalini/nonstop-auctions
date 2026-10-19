// Test-only local Supabase HTTP fixture. Never uses .env.local or a hosted database.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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
let photoObjects = new Map();
let failUpload = false;
let uploadsBeforeFailure = null;
let loseSubmitResponse = false;
const createLot = (status = 'PREVIEW') => ({ id, room_id: room.id, seller_id: '00000000-0000-0000-0000-000000000101',
  title: 'Release test catalogue item', description: 'Catalogue description', condition_report: 'Condition report', shipping_info: 'Collection information',
  starting_bid: 100, current_bid: 100, minimum_increment: 10, bid_count: status === 'ACTIVE_BIDDING' ? 1 : 0,
  status, preview_duration_seconds: 30, first_bid_duration_seconds: 30, bid_extension_seconds: 5, requeue_delay_days: 7,
  ends_at: new Date(Date.now() + (status === 'ACTIVE_BIDDING' ? 5000 : 30000)).toISOString(), next_eligible_at: new Date().toISOString(),
  queue_position: 1, is_premium: false, created_at: new Date().toISOString() });
let performanceTrace = [];
const fixtureDelay = Number(process.env.PERFORMANCE_API_DELAY_MS ?? 0);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:54399');
  if (url.pathname === '/_test/performance-config') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({delayMs:fixtureDelay})); return;
  }
  if (url.pathname === '/_test/performance') {
    if (req.method === 'DELETE') performanceTrace = [];
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(performanceTrace)); return;
  }
  const trace = { path: url.pathname, query: url.search, startedAt: performance.now(), durationMs: 0, bytes: 0, rows: 0 };
  if (!url.pathname.startsWith('/_test/') && req.method !== 'OPTIONS') {
    performanceTrace.push(trace);
    res.on('finish', () => { trace.durationMs = performance.now() - trace.startedAt; });
    if (fixtureDelay) await new Promise(resolve => setTimeout(resolve, fixtureDelay));
  }
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3005');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'apikey,authorization,content-type,x-client-info,prefer');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  const reply = (data, code = 200) => { res.writeHead(code); const payload = JSON.stringify(data); trace.bytes = Buffer.byteLength(payload); trace.rows = Array.isArray(data) ? data.length : 1; res.end(payload); };
  const body = async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };
  if (url.pathname === '/_test/state') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const state = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (state.mode === 'empty') { lots = []; images = []; rooms = [room]; accountsEnabled = false; notifications = []; watchlist = []; photoObjects = new Map(); failUpload = false; uploadsBeforeFailure = null; loseSubmitResponse = false; }
    if (state.mode === 'seller') {
      accountsEnabled = true;
      rooms = [room, jewellery, ...['Watch','Art','Design','Dining','Music','Technology','Collectables','Fashion','Motoring','Sport'].map((name,index) => ({ ...room, id: `10000000-0000-0000-0000-0000000000${String(index+20).padStart(2,'0')}`, slug: `${name.toLowerCase()}-room`, name: `The ${name} Room`, display_order: index+20 }))];
    }
    if (state.failUpload !== undefined) failUpload = state.failUpload;
    if (state.failUploadAfter !== undefined) uploadsBeforeFailure = state.failUploadAfter;
    if (state.loseSubmitResponse !== undefined) loseSubmitResponse = state.loseSubmitResponse;
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
    if (state.mode === 'performance') {
      accountsEnabled = true; rooms = [room, jewellery]; notifications = []; watchlist = [];
      lots = rooms.flatMap((r, ri) => [
        { ...createLot('FIRST_BID_WINDOW'), id: ri ? '20000000-0000-0000-0000-000000000101' : id, room_id: r.id, ends_at: new Date(Date.now()+3600000).toISOString() },
        ...Array.from({length:6},(_,i)=>({ ...createLot('WAITING'), id: `30000000-0000-0000-${String(ri).padStart(4,'0')}-${String(i+1).padStart(12,'0')}`, room_id:r.id, queue_position:i+2 })),
        ...Array.from({length:120},(_,i)=>({ ...createLot('SOLD'), id: `40000000-0000-0000-${String(ri).padStart(4,'0')}-${String(i+1).padStart(12,'0')}`, room_id:r.id, queue_position:i+8, seller_id:i%2 ? accountA : accountB, highest_bidder_id:i%2 ? accountB : accountA, winning_bid:125.5, sold_at:new Date(Date.UTC(2026,0,1,0,i)).toISOString() })),
      ]);
      watchlist = [ {id:'watched',user_id:accountA,lot_id:id} ];
      images = lots.flatMap(lot=>Array.from({length:3},(_,i)=>{
        const path=`${lot.seller_id}/${lot.id}/${i}.png`;
        photoObjects.set(path,{type:'image/png',buffer:Buffer.from('fixture')});
        return { id:`${lot.id}-${i}`, lot_id:lot.id,storage_path:path,image_url:`storage:lot-photos/${path}`,sort_order:i,created_at:new Date().toISOString() };
      }));
    }
    if (state.mode === 'history') {
      accountsEnabled = true; rooms = [room];
      lots = [{ ...createLot('SOLD'), seller_id: accountA, highest_bidder_id: accountB, winning_bid: 125.50, current_bid: 125.50, sold_at: new Date().toISOString(), title: 'Completed history item' }];
      images = [{ id, lot_id: id, image_url: '/images/auction-house-background.png', sort_order: 0 }];
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
        finished.unsold_at = new Date().toISOString(); finished.next_eligible_at = new Date().toISOString(); finished.queue_position = 4;
      }
      next.status = 'PREVIEW'; next.preview_starts_at = new Date().toISOString(); next.ends_at = new Date(Date.now()+30000).toISOString();
    }
    if (state.hallEmpty) lots = lots.filter(lot => lot.room_id !== room.id);
    if (state.retireHall) { const hallLot = lots.find(lot => lot.id === id); if (hallLot) hallLot.status = 'SOLD'; }
    if (state.notification) notifications.push({ ...state.notification, auction_run: new Date().toISOString(), created_at: new Date().toISOString(), read_at: null });
    return reply({ ok: true });
  }
  if (url.pathname === '/_test/seller-state') return reply({ lots:lots.length, images:images.length, objects:photoObjects.size });
  if (url.pathname.endsWith('/rpc/completed_auctions_page')) {
    const account = requestAccount(req), data = await body();
    if (!account) return reply({message:'Authentication required'},401);
    if (!['buyer','seller'].includes(data.p_mode)) return reply({message:'Invalid history mode'},400);
    const rows = lots.filter(lot => lot.status === 'SOLD' && (data.p_mode === 'buyer' ? lot.highest_bidder_id === account : lot.seller_id === account) && (!data.p_lot_id || lot.id === data.p_lot_id))
      .sort((a,b)=>String(b.sold_at).localeCompare(String(a.sold_at)) || b.id.localeCompare(a.id))
      .slice(data.p_offset ?? 0, (data.p_offset ?? 0) + (data.p_limit ?? 51));
    return reply(rows.map(lot => {
      const photo = images.filter(image=>image.lot_id===lot.id).sort((a,b)=>a.sort_order-b.sort_order)[0];
      return {lot_id:lot.id,title:lot.title,sale_price:lot.winning_bid,completed_at:lot.sold_at,seller_name:'History Seller',buyer_name:'History Buyer',is_buyer:lot.highest_bidder_id===account,image_url:photo?.image_url??null,storage_path:photo?.storage_path??null};
    }));
  }
  if (url.pathname.endsWith('/rpc/my_completed_auctions')) {
    const account = requestAccount(req);
    return reply(lots.filter(lot => lot.status === 'SOLD' && account && (lot.seller_id === account || lot.highest_bidder_id === account)).map(lot => ({ lot_id: lot.id, sale_price: lot.winning_bid, completed_at: lot.sold_at, seller_name: 'History Seller', buyer_name: 'History Buyer', is_buyer: lot.highest_bidder_id === account })));
  }
  if (url.pathname.endsWith('/rpc/auction_server_time')) return reply(new Date().toISOString());
  if (url.pathname.endsWith('/rpc/advance_room_lifecycle')) { const data = await body(); return reply(lots.find(lot => lot.room_id === data.p_room_id && ['PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING'].includes(lot.status)) ?? null); }
  if (url.pathname.endsWith('/rpc/lot_watchlist_count')) { const data = await body(); return reply(watchlist.filter(item => item.lot_id === data.p_lot_id).length); }
  if (accountsEnabled && url.pathname === '/auth/v1/token') {
    const data = await body(); const account = data.email === 'one@example.test' ? accountA : data.email === 'two@example.test' ? accountB : null;
    if (account) return reply({ access_token: accessToken(account), refresh_token: `fixture-${account}`, token_type: 'bearer', expires_in: 3600, user: user(account) });
  }
  if (accountsEnabled && url.pathname === '/auth/v1/user') { const account = requestAccount(req); if (account) return reply(user(account)); }
  if (accountsEnabled && url.pathname === '/auth/v1/logout') return reply({});
  if (url.pathname.startsWith('/auth/v1/')) return reply({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
  const account = requestAccount(req);
  if (url.pathname.startsWith('/rest/v1/rpc/') && /seller/.test(url.pathname)) {
    if (!account) return reply({ message: 'Sign in first' },401);
    const data = await body();
    if (url.pathname.endsWith('/save_seller_draft')) {
      const existing = lots.find(lot => lot.seller_id === account && lot.submission_key === data.p_submission_key);
      if (existing) return reply(existing);
      const created = { ...createLot('DRAFT'), id: randomUUID(), seller_id: account, submission_key: data.p_submission_key, room_id: data.p_room_id, title: data.p_title, description: data.p_description, starting_bid: data.p_starting_bid, current_bid: 0, ends_at: null, queue_position: 0 };
      lots.push(created); return reply(created);
    }
    const lot = lots.find(lot => lot.id === data.p_lot_id && lot.seller_id === account);
    if (url.pathname.endsWith('/prepare_seller_photo') && lot) {
      let image = images.find(image => image.id === data.p_image_id);
      if (!image) {
        const path = `${account}/${lot.id}/${data.p_image_id}.${data.p_extension}`;
        image = { id: data.p_image_id, lot_id: lot.id, storage_path: path, image_url: `storage:lot-photos/${path}`, sort_order: images.filter(image => image.lot_id === lot.id).length };
        images.push(image);
      }
      return reply(image);
    }
    if (url.pathname.endsWith('/submit_seller_lot') && lot) {
      lot.status = 'WAITING'; lot.queue_position = 1;
      if (loseSubmitResponse) { loseSubmitResponse = false; return reply({ message: 'Test lost submission response' },503); }
      return reply(lot);
    }
    if (url.pathname.endsWith('/remove_seller_photo')) { images = images.filter(image => image.id !== data.p_image_id); return reply(null); }
    if (url.pathname.endsWith('/discard_seller_draft') && lot?.status === 'DRAFT') {
      lots = lots.filter(item => item !== lot); images = images.filter(image => image.lot_id !== lot.id); return reply(null);
    }
    return reply({ message: 'Submission not found' },404);
  }
  if (url.pathname === '/storage/v1/object/sign/lot-photos') {
    const data = await body();
    return reply(data.paths.map(path => ({ path, error: photoObjects.has(path) ? null : 'not found', signedURL: photoObjects.has(path) ? `/object/sign/lot-photos/${path}?token=fixture` : null })));
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/lot-photos/')) {
    const stored = photoObjects.get(url.pathname.split('/lot-photos/')[1]);
    if (!stored) return reply({},404);
    res.setHeader('Content-Type',stored.type); res.writeHead(200); res.end(stored.buffer); return;
  }
  if (url.pathname.startsWith('/storage/v1/object/info/lot-photos/')) {
    const stored = photoObjects.get(url.pathname.split('/lot-photos/')[1]);
    return stored ? reply({ id:'fixture', metadata:{ size:stored.buffer.length, mimetype:stored.type } }) : reply({ message:'not found' },404);
  }
  if (url.pathname === '/storage/v1/object/lot-photos' && req.method === 'DELETE') {
    const data = await body(); for (const path of data.prefixes) photoObjects.delete(path); return reply([]);
  }
  if (url.pathname.startsWith('/storage/v1/object/lot-photos/') && req.method === 'POST') {
    if (failUpload || uploadsBeforeFailure === 0) return reply({ message:'Test interrupted photo upload' },503);
    if (uploadsBeforeFailure !== null) uploadsBeforeFailure--;
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), { headers:{ 'content-type':req.headers['content-type'] } }).formData();
    const file = [...form.values()].find(value => typeof value !== 'string');
    const path = url.pathname.split('/lot-photos/')[1];
    photoObjects.set(path,{ type:file.type, buffer:Buffer.from(await file.arrayBuffer()) });
    return reply({ Key:`lot-photos/${path}`, Id:randomUUID() });
  }
  let rows = url.pathname.endsWith('/auction_rooms') ? rooms
    : url.pathname.endsWith('/lots') ? lots.filter(lot => lot.status !== 'DRAFT' || lot.seller_id === account) : url.pathname.endsWith('/lot_images') ? images
    : url.pathname.endsWith('/notifications') ? notifications.filter(item => item.user_id === account)
    : url.pathname.endsWith('/watchlist') ? watchlist.filter(item => item.user_id === account) : [];
  for (const [column, filter] of url.searchParams) {
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[column]) === filter.slice(3));
    if (filter.startsWith('neq.')) rows = rows.filter(row => String(row[column]) !== filter.slice(4));
    if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[column])));
    if (filter === 'is.null') rows = rows.filter(row => row[column] === null);
  }
  const order = url.searchParams.get('order');
  if (order) rows = [...rows].sort((a,b)=>{
    for(const part of order.split(',')) { const [column,direction] = part.split('.'); const delta = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0; if(delta) return direction === 'desc' ? -delta : delta; }
    return 0;
  });
  const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000);
  if (req.method === 'GET') rows = rows.slice(offset, offset + limit);
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
  const selection = url.searchParams.get('select');
  if (selection && selection !== '*') rows = rows.map(row=>Object.fromEntries(selection.split(',').filter(column=>column in row).map(column=>[column,row[column]])));
  return reply(rows);
});
server.listen(54399, '127.0.0.1');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.PERFORMANCE_NEXT_START === '1' ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3005'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_browser_test', AUCTION_DEMO_MODE: 'true' },
});
const stop = () => { child.kill(); server.close(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.on('exit', code => { server.close(); process.exitCode = code ?? 0; });
