// Test-only local Supabase HTTP fixture. Never uses .env.local or a hosted database.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const listingTerms = new Map();
let fixtureReferenceCounter = 20000;
let images = [];
let photoObjects = new Map();
let failUpload = false;
let uploadsBeforeFailure = null;
let loseSubmitResponse = false;
const stripeAttemptId = '70000000-0000-0000-0000-000000000001';
const stripeSessionId = 'cs_test_browser_fixture';
const stripeAccount = 'acct_browserFixture';
let stripeAttempt = null;
let stripeCaptured = false;
let stripeSessionOpen = false;
let stripeEvents = new Set();
const createLot = (status = 'PREVIEW') => ({
  relist_unlimited:false,max_auto_relistings:5,auto_relistings_used:0,completed_attempts:0,
  final_unsold_at:null,removal_requested_at:null,removed_at:null,pending_relist_unlimited:null,pending_max_auto_relistings:null,
  lot_reference: 1001, id, room_id: room.id, seller_id: '00000000-0000-0000-0000-000000000101',
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
  const readBody = async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString(); };
  const body = async () => JSON.parse(await readBody() || '{}');
  if (url.pathname.startsWith('/_test/stripe/v1/')) {
    if (req.headers.authorization !== 'Bearer sk_test_browser_fixture') return reply({ error: { message: 'Invalid fixture key' } }, 403);
    if (url.pathname.endsWith(`/accounts/${stripeAccount}`)) return reply({
      id: stripeAccount, country: 'GB', details_submitted: true, charges_enabled: true,
      payouts_enabled: true, capabilities: { card_payments: 'active' },
    });
    if (!stripeAttempt || req.headers['stripe-account'] !== stripeAccount) return reply({ error: { message: 'Invalid fixture scope' } }, 403);
    if (req.method === 'POST' && url.pathname.endsWith('/checkout/sessions')) {
      const form = new URLSearchParams(await readBody());
      if (req.headers['idempotency-key'] !== `nonstop-test-checkout-${stripeAttemptId}` ||
        form.get('line_items[0][price_data][unit_amount]') !== String(stripeAttempt.total_minor) ||
        form.get('line_items[0][price_data][currency]') !== 'gbp' ||
        form.get('metadata[nonstop_test_attempt]') !== stripeAttemptId) return reply({ error: { message: 'Invalid fixture session' } }, 400);
      stripeSessionOpen = true;
    } else if (!stripeSessionOpen || !url.pathname.endsWith(`/checkout/sessions/${stripeSessionId}`)) {
      return reply({ error: { message: 'Unknown fixture session' } }, 404);
    }
    const metadata = { nonstop_test_attempt: stripeAttemptId };
    return reply({ id: stripeSessionId, livemode: false, mode: 'payment', currency: 'gbp', metadata, amount_total: stripeAttempt.total_minor,
      status: stripeCaptured ? 'complete' : 'open', payment_status: stripeCaptured ? 'paid' : 'unpaid',
      payment_method_types: ['card'], url: `https://checkout.stripe.com/c/pay/${stripeSessionId}`,
      payment_intent: stripeCaptured ? { id: 'pi_browser_fixture', livemode: false, currency: 'gbp', status: 'succeeded',
        amount: stripeAttempt.total_minor, amount_received: stripeAttempt.total_minor, metadata } : null,
    });
  }
  if (url.pathname === '/_test/listing-terms') return reply(listingTerms.get(url.searchParams.get('lot')) ?? null);
  if (url.pathname === '/_test/state') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const state = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (state.mode === 'empty') { lots = []; images = []; rooms = [room]; accountsEnabled = false; notifications = []; watchlist = []; photoObjects = new Map(); listingTerms.clear(); failUpload = false; uploadsBeforeFailure = null; loseSubmitResponse = false; }
    if (state.mode === 'transactions' || state.mode === 'checkout') {
      stripeAttempt=null;stripeEvents=new Set();stripeCaptured=false;stripeSessionOpen=false;
      accountsEnabled=true;rooms=[room];lots=[{...createLot('SOLD'),seller_id:accountB,highest_bidder_id:accountA,winning_bid:275,sold_at:new Date().toISOString()}];
      addressRows=[];messageRows=[];eventRows=[];
      orderRows=[{id:'50000000-0000-0000-0000-000000000001',lot_id:id,buyer_id:accountA,seller_id:accountB,preview_started_at:new Date().toISOString(),created_at:new Date().toISOString(),version:0,payment_state:'NOT_RECORDED',shipping_state:'AWAITING_ADDRESS',address_snapshot:null,service:'',tracking:'',delivery_notes:'',dispatched_at:null,buyer_received_at:null,seller_delivery_reported_at:null}];
      if (state.mode === 'checkout') Object.assign(orderRows[0], {
        payment_state: 'UNPAID', shipping_state: 'AWAITING_PAYMENT', winning_minor: 27500,
        terms_snapshot: { mode: 'both', postage_minor: 495, country: 'GB', postcode_areas: ['SW'],
          service: 'Royal Mail', handling_days: 2, collection_area: 'Central London' },
        fulfilment_method: null, postage_minor: null, refunded_minor: 0, seller_handover_at: null,
      });
      conversationRows=[{id:'60000000-0000-0000-0000-000000000001',lot_id:id,buyer_id:accountA,seller_id:accountB,created_at:new Date().toISOString(),buyer_read_at:new Date().toISOString(),seller_read_at:new Date().toISOString()}];
    }
    if (state.captureStripe) stripeCaptured = true;
    if (state.mode === 'seller') {
      accountsEnabled = true;
      rooms = [room, jewellery, ...['Watch','Art','Design','Dining','Music','Technology','Collectables','Fashion','Motoring','Sport'].map((name,index) => ({ ...room, id: `10000000-0000-0000-0000-0000000000${String(index+20).padStart(2,'0')}`, slug: `${name.toLowerCase()}-room`, name: `The ${name} Room`, display_order: index+20 }))];
    }
    if (state.signedImageToken) {
      photoObjects.set('audit.png',{buffer:readFileSync('public/images/auction-house-background.png'),type:'image/png'});
      images[0].image_url=`http://127.0.0.1:54399/storage/v1/object/sign/lot-photos/audit.png?token=${state.signedImageToken}`;
    }
    if (state.accountsEnabled !== undefined) accountsEnabled = state.accountsEnabled;
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
      notifications = [accountA, accountB].map((account,index) => ({ id: `40000000-0000-0000-0000-00000000010${index+1}`, user_id: account, lot_id: id, kind: index ? 'WATCHED_SOLD' : 'WON', lot_reference: 1001, lot_title: index ? 'Private account two item' : 'Private account one item', auction_run: new Date().toISOString(), created_at: new Date().toISOString(), read_at: null }));
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
    if (state.mode === 'gallery') {
      rooms=[jewellery,room];accountsEnabled=false;
      lots=[{...createLot('PREVIEW'),ends_at:new Date(Date.now()+3600000).toISOString(),title:'Gallery fixture lot',description:'Carefully described condition.',condition_report:'Additional condition information.'},
       {...createLot('WAITING'),id:'20000000-0000-0000-0000-000000000702',title:'Selected queued lot',queue_position:2}];
      images=[{id:'one',lot_id:id,image_url:'/images/auction-house-background.png?gallery=1',sort_order:0},
        {id:'two',lot_id:id,image_url:'/images/auction-house-background.png?gallery=2',sort_order:1},
        {id:'three',lot_id:id,image_url:'/images/auction-house-background.png?gallery=3',sort_order:2}];
    }
    if (state.mode === 'catalogue') {
      rooms=[room,jewellery];accountsEnabled=false;
      lots=[{...createLot('PREVIEW'),ends_at:new Date(Date.now()+3600000).toISOString()},...Array.from({length:51},(_,i)=>({...createLot(i===1?'UNSOLD':'WAITING'),id:`30000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,title:`Catalogue item ${i+1}`,queue_position:i+2})),
       {...createLot('SOLD'),id:'90000000-0000-0000-0000-000000000001',title:'Excluded sold item'},
       {...createLot('CANCELLED'),id:'90000000-0000-0000-0000-000000000002',title:'Excluded removed item'},
       {...createLot('EXPIRED'),id:'90000000-0000-0000-0000-000000000003',title:'Excluded exhausted item'},
       {...createLot('WAITING'),room_id:jewellery.id,id:'90000000-0000-0000-0000-000000000004',title:'Excluded other room'}];
      images=lots.map(lot=>({id:lot.id,lot_id:lot.id,image_url:'/images/auction-house-background.png',sort_order:0}));
    }
    if (state.mode === 'management') {
      accountsEnabled=true;rooms=[room];
      lots=[{...createLot('WAITING'),seller_id:accountA,title:'Queued managed listing'},
        {...createLot('PREVIEW'),id:'20000000-0000-0000-0000-000000000702',seller_id:accountA,title:'Active managed listing'},
        {...createLot('EXPIRED'),id:'20000000-0000-0000-0000-000000000703',seller_id:accountA,title:'Exhausted managed listing',max_auto_relistings:0,completed_attempts:1,final_unsold_at:new Date().toISOString()}];
      images=lots.map(lot=>({id:lot.id,lot_id:lot.id,image_url:'/images/auction-house-background.png',sort_order:0}));
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
    if(state.photoAuditSecondRoom){
      const base=lots.find(l=>l.submission_key);const sources=images.filter(i=>i.lot_id===base?.id);
      const copy={...base,id:randomUUID(),room_id:jewellery.id,title:'Storage audit second room',status:'PREVIEW',ends_at:new Date(Date.now()+3600000).toISOString()};lots.push(copy);
      for(const source of sources){const imageId=randomUUID(),path=`${accountA}/${copy.id}/${imageId}.png`;const clone={...source,id:imageId,lot_id:copy.id,storage_path:path,thumbnail_path:path+'.thumb.webp',display_path:path+'.display.webp',image_url:'storage:lot-photos/'+path};images.push(clone);for(const key of ['storage_path','thumbnail_path','display_path']){if(photoObjects.has(source[key]))photoObjects.set(clone[key],photoObjects.get(source[key]));}}
    }
    if (state.photoAuditLegacy) { for(const image of images){image.thumbnail_path=null;image.display_path=null;}const base=lots.find(l=>l.submission_key);if(base)base.status='PREVIEW'; }
    if (state.photoAuditDraft) { const base=lots.find(l=>l.submission_key);if(base)base.status='DRAFT'; }
    if (state.photoAuditCopies) {
      const base=lots.find(l=>l.submission_key);const sources=images.filter(i=>i.lot_id===base?.id);
      for(let n=1;n<=state.photoAuditCopies;n++){
        const copy={...base,id:randomUUID(),title:`Storage audit lot ${n}`,status:n<=2?'SOLD':'WAITING',queue_position:n+1,highest_bidder_id:accountA,sold_at:new Date().toISOString(),winning_bid:100};lots.push(copy);
        for(const source of sources){const imageId=randomUUID();const path=`${accountA}/${copy.id}/${imageId}.png`;const clone={...source,id:imageId,lot_id:copy.id,storage_path:path,thumbnail_path:path+'.thumb.webp',display_path:path+'.display.webp',image_url:'storage:lot-photos/'+path};images.push(clone);for(const key of ['storage_path','thumbnail_path','display_path']){if(photoObjects.has(source[key]))photoObjects.set(clone[key],photoObjects.get(source[key]));}}
      }
      base.status='PREVIEW';base.ends_at=new Date(Date.now()+3600000).toISOString();watchlist=lots.map(lot=>({id:randomUUID(),user_id:accountA,lot_id:lot.id}));
    }
    if (state.hallEmpty) lots = lots.filter(lot => lot.room_id !== room.id);
    if (state.retireHall) { const hallLot = lots.find(lot => lot.id === id); if (hallLot) hallLot.status = 'SOLD'; }
    if (state.notification) notifications.push({ lot_reference: 1001, ...state.notification, auction_run: new Date().toISOString(), created_at: new Date().toISOString(), read_at: null });
    lots.forEach((lot,index)=>{ if(lot.lot_reference === undefined || (lot.lot_reference === 1001 && lot.id !== id)) lot.lot_reference=1002+index; });
    return reply({ ok: true });
  }
  if (url.pathname === '/_test/photo-metrics') return reply([...photoObjects].map(([path,object])=>({path,bytes:object.buffer.length,type:object.type})));
  if (url.pathname === '/_test/seller-state') return reply({ lots:lots.length, images:images.length, objects:photoObjects.size });
  if (url.pathname.endsWith('/rpc/completed_auctions_page') || url.pathname.endsWith('/rpc/completed_auctions_page_with_reference')) {
    const account = requestAccount(req), data = await body();
    if (!account) return reply({message:'Authentication required'},401);
    if (!['buyer','seller'].includes(data.p_mode)) return reply({message:'Invalid history mode'},400);
    const rows = lots.filter(lot => lot.status === 'SOLD' && (data.p_mode === 'buyer' ? lot.highest_bidder_id === account : lot.seller_id === account) && (!data.p_lot_id || lot.id === data.p_lot_id))
      .sort((a,b)=>String(b.sold_at).localeCompare(String(a.sold_at)) || b.id.localeCompare(a.id))
      .slice(data.p_offset ?? 0, (data.p_offset ?? 0) + (data.p_limit ?? 51));
    return reply(rows.map(lot => {
      const photo = images.filter(image=>image.lot_id===lot.id).sort((a,b)=>a.sort_order-b.sort_order)[0];
      return {lot_reference:lot.lot_reference,lot_id:lot.id,title:lot.title,sale_price:lot.winning_bid,completed_at:lot.sold_at,seller_name:'History Seller',buyer_name:'History Buyer',is_buyer:lot.highest_bidder_id===account,image_url:photo?.image_url??null,storage_path:photo?.storage_path??null};
    }));
  }
  if(url.pathname.endsWith('/rpc/unread_message_count'))return reply(0);
  if(url.pathname.endsWith('/rpc/transaction_action')){
    const account=requestAccount(req),{action,payload:p}=await body();if(!account)return reply({message:'Sign in required'},403);
    if(action==='save_address'){
      const aid=p.id||randomUUID(),existing=addressRows.find(a=>a.id===aid);
      if(existing&&existing.user_id!==account)return reply({message:'Address unavailable'},403);
      if(p.default)addressRows.filter(a=>a.user_id===account).forEach(a=>{a.is_default=false;});
      addressRows=addressRows.filter(a=>a.id!==aid);
      addressRows.push({id:aid,user_id:account,details:p.details,is_default:!!p.default,created_at:existing?.created_at??new Date().toISOString()});return reply(aid);
    }
    if(action==='delete_address'){addressRows=addressRows.filter(a=>a.id!==p.id||a.user_id!==account);return reply(true);}
    if(action==='conversation')return reply(conversationRows[0].id);
    if(action==='send'){const mid=randomUUID();messageRows.push({id:mid,conversation_id:p.conversation,sender_id:account,body:p.body,client_key:p.key,created_at:new Date().toISOString(),deleted_at:null});return reply(mid);}
    if(action==='shipping'){const o=orderRows.find(o=>o.id===p.order&&o.seller_id===account);if(!o)return reply({message:'Unavailable'},403);Object.assign(o,{shipping_state:p.state,service:p.service,tracking:p.tracking,delivery_notes:p.notes,dispatched_at:new Date().toISOString(),version:o.version+1});return reply(true);}
    if(action==='receipt'){const o=orderRows.find(o=>o.id===p.order&&o.buyer_id===account);if(!o)return reply({message:'Unavailable'},403);Object.assign(o,{shipping_state:'DELIVERED',buyer_received_at:new Date().toISOString(),version:o.version+1});return reply(true);}
    if(action==='select_address'){const o=orderRows.find(o=>o.id===p.order&&o.buyer_id===account);const a=addressRows.find(a=>a.id===p.address&&a.user_id===account);if(!o||!a)return reply({message:'Unavailable'},403);o.address_snapshot=structuredClone(a.details);o.shipping_state='AWAITING_DISPATCH';o.version++;return reply(true);}
    return reply(true);
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
  if (req.headers.authorization === 'Bearer service_role_browser_fixture') {
    if (url.pathname.endsWith('/seller_stripe_test_accounts')) return reply([{ stripe_account: stripeAccount }]);
    if (url.pathname.endsWith('/stripe_checkout_attempts')) return reply(stripeAttempt ? [stripeAttempt] : []);
    if (url.pathname.endsWith('/stripe_payment_events')) {
      const event = url.searchParams.get('id')?.slice(3);
      return reply(stripeEvents.has(event) ? [{ id: event }] : []);
    }
    if (url.pathname.endsWith('/rpc/reserve_test_checkout')) {
      const data = await body();
      const order = orderRows.find(item => item.id === data.p_order && item.buyer_id === data.p_buyer);
      if (!order || data.p_account !== stripeAccount || data.p_method !== 'collection') return reply({ message: 'Invalid fixture order' }, 400);
      stripeAttempt ??= { id: stripeAttemptId, order_id: order.id, stripe_account: stripeAccount, session_id: null,
        method: 'collection', postage_minor: 0, total_minor: order.winning_minor, created_at: new Date().toISOString() };
      Object.assign(order, { payment_state: 'PENDING', fulfilment_method: 'collection', postage_minor: 0 });
      return reply(stripeAttempt);
    }
    if (url.pathname.endsWith('/rpc/bind_test_checkout')) {
      const data = await body();
      if (data.p_attempt !== stripeAttempt?.id || data.p_session !== stripeSessionId) return reply(false);
      stripeAttempt.session_id = data.p_session;
      return reply(true);
    }
    if (url.pathname.endsWith('/rpc/record_test_payment')) {
      const data = await body();
      const order = orderRows.find(item => item.id === stripeAttempt?.order_id);
      if (!order || data.p_attempt !== stripeAttempt.id || data.p_session !== stripeSessionId ||
        data.p_intent !== 'pi_browser_fixture' || data.p_total !== stripeAttempt.total_minor || data.p_kind !== 'paid') {
        return reply({ message: 'Invalid fixture event' }, 400);
      }
      if (stripeEvents.has(data.p_event)) return reply({ message: 'Duplicate fixture write' }, 409);
      stripeEvents.add(data.p_event);
      Object.assign(order, { payment_state: 'PAID', shipping_state: 'PREPARING_COLLECTION' });
      return reply(null);
    }
  }
  if (url.pathname.endsWith('/rpc/set_listing_fulfilment')) {
    const data = await body();
    const lot = lots.find(item => item.id === data.p_lot && item.seller_id === account && item.status === 'DRAFT');
    if (!lot) return reply({ message: 'Draft unavailable' }, 404);
    listingTerms.set(lot.id, data.p_terms);
    return reply(null);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/') && /seller/.test(url.pathname)) {
    if (!account) return reply({ message: 'Sign in first' },401);
    const data = await body();
    if (url.pathname.endsWith('/save_seller_draft') || url.pathname.endsWith('/save_seller_draft_with_relisting')) {
      const existing = lots.find(lot => lot.seller_id === account && lot.submission_key === data.p_submission_key);
      if (existing) { if(existing.status==='DRAFT'){existing.relist_unlimited=data.p_relist_unlimited??existing.relist_unlimited;existing.max_auto_relistings=data.p_max_auto_relistings??existing.max_auto_relistings;} return reply(existing); }
      const created = { ...createLot('DRAFT'), lot_reference: fixtureReferenceCounter++, id: randomUUID(), seller_id: account, submission_key: data.p_submission_key, room_id: data.p_room_id, title: data.p_title, description: data.p_description, starting_bid: data.p_starting_bid, relist_unlimited:data.p_relist_unlimited??false,max_auto_relistings:data.p_max_auto_relistings??5,current_bid: 0, ends_at: null, queue_position: 0 };
      lots.push(created); return reply(created);
    }
    const lot = lots.find(lot => lot.id === data.p_lot_id && lot.seller_id === account);
    if (url.pathname.endsWith('/manage_seller_listing')) {
      if (!lot || ['DRAFT','SOLD'].includes(lot.status)) return reply({message:'Listing not found or cannot be managed'},400);
      const active=['PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING'].includes(lot.status);
      if (data.p_remove) {
        lot.removal_requested_at??=new Date().toISOString();
        if(!active){lot.status='CANCELLED';lot.removed_at=lot.removal_requested_at;}
      } else if(active) {
        lot.pending_relist_unlimited=data.p_relist_unlimited;lot.pending_max_auto_relistings=data.p_max_auto_relistings;
      } else {
        lot.relist_unlimited=data.p_relist_unlimited;lot.max_auto_relistings=data.p_max_auto_relistings;
        if(lot.status==='UNSOLD'&&!lot.relist_unlimited&&lot.auto_relistings_used>lot.max_auto_relistings){lot.status='EXPIRED';lot.final_unsold_at=new Date().toISOString();}
        else if(lot.status==='EXPIRED'&&(lot.relist_unlimited||lot.auto_relistings_used<lot.max_auto_relistings||(lot.completed_attempts>0&&lot.auto_relistings_used>=lot.completed_attempts&&lot.auto_relistings_used===lot.max_auto_relistings))) {if(!(lot.completed_attempts>0&&lot.auto_relistings_used>=lot.completed_attempts))lot.auto_relistings_used++;lot.status='UNSOLD';lot.final_unsold_at=null;}
      }
      return reply(lot);
    }
    if ((url.pathname.endsWith('/prepare_seller_photo') || url.pathname.endsWith('/prepare_seller_photo_variants')) && lot) {
      let image = images.find(image => image.id === data.p_image_id);
      if (!image) {
        const path = `${account}/${lot.id}/${data.p_image_id}.${data.p_extension}`;
        image = { id: data.p_image_id, lot_id: lot.id, storage_path: path, image_url: `storage:lot-photos/${path}`, sort_order: images.filter(image => image.lot_id === lot.id).length };
        images.push(image);
      }
      if(url.pathname.endsWith('/prepare_seller_photo_variants')){image.thumbnail_path=image.storage_path+'.thumb.webp';image.display_path=image.storage_path+'.display.webp';}
      return reply(image);
    }
    if (url.pathname.endsWith('/submit_seller_lot') && lot) {
      lot.status = 'WAITING'; lot.queue_position = 1;
      if (loseSubmitResponse) { loseSubmitResponse = false; return reply({ message: 'Test lost submission response' },503); }
      return reply(lot);
    }
    if (url.pathname.endsWith('/remove_seller_photo')) { images = images.filter(image => image.id !== data.p_image_id); return reply(null); }
    if (url.pathname.endsWith('/discard_seller_draft') && lot?.status === 'DRAFT') {
      lots = lots.filter(item => item !== lot); images = images.filter(image => image.lot_id !== lot.id); listingTerms.delete(lot.id); return reply(null);
    }
    return reply({ message: 'Submission not found' },404);
  }
  if (url.pathname.endsWith('/rpc/lot_photo_delivery')) {
    const data=await body();const image=images.find(i=>i.id===data.p_image_id);const lot=lots.find(l=>l.id===image?.lot_id);const room=rooms.find(r=>r.id===lot?.room_id);
    if(!image?.storage_path||!lot|| (lot.status==='DRAFT'&&lot.seller_id!==account))return reply([]);
    const path=data.p_size==='thumb'?image.thumbnail_path:data.p_size==='display'?image.display_path:image.storage_path;
    return reply([{object_path:path??image.storage_path,fallback_path:image.storage_path,public_cache:lot.status!=='DRAFT'&&Boolean(room?.is_active)}]);
  }
  if (url.pathname === '/storage/v1/object/sign/lot-photos') {
    const data = await body();
    return reply(data.paths.map(path => ({ path, error: photoObjects.has(path) ? null : 'not found', signedURL: photoObjects.has(path) ? `/object/sign/lot-photos/${path}?token=fixture` : null })));
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/lot-photos/') || url.pathname.startsWith('/storage/v1/object/authenticated/lot-photos/') || (req.method==='GET'&&url.pathname.startsWith('/storage/v1/object/lot-photos/'))) {
    const stored = photoObjects.get(url.pathname.split('/lot-photos/')[1]);
    if (!stored) return reply({},404);
    trace.bytes=stored.buffer.length;res.setHeader('Cache-Control','private, max-age=3600');res.setHeader('Content-Type',stored.type); res.writeHead(200); res.end(stored.buffer); return;
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
    : url.pathname.endsWith('/listing_fulfilment_terms') ? lots.filter(lot => lot.seller_id === account && listingTerms.has(lot.id))
      .map(lot => ({ lot_id: lot.id, details: listingTerms.get(lot.id) }))
    : url.pathname.endsWith('/notifications') ? notifications.filter(item => item.user_id === account)
    : url.pathname.endsWith('/delivery_addresses') ? addressRows.filter(a=>a.user_id===account) : url.pathname.endsWith('/fulfilment_orders') ? orderRows.filter(o=>[o.buyer_id,o.seller_id].includes(account)) : url.pathname.endsWith('/conversations') ? conversationRows.filter(c=>[c.buyer_id,c.seller_id].includes(account)) : url.pathname.endsWith('/private_messages') ? messageRows.filter(m=>conversationRows.some(c=>c.id===m.conversation_id&&[c.buyer_id,c.seller_id].includes(account))) : url.pathname.endsWith('/fulfilment_events') ? eventRows : url.pathname.endsWith('/watchlist') ? watchlist.filter(item => item.user_id === account) : [];
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
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_browser_test', AUCTION_DEMO_MODE: 'true',
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=./tests/helpers/stripe-fetch-fixture.mjs'].filter(Boolean).join(' '),
    STRIPE_TEST_CHECKOUT_ENABLED: process.env.TEST_STRIPE_CHECKOUT === '1' ? 'true' : 'false',
    STRIPE_TEST_APP_ORIGIN: 'http://127.0.0.1:3005', STRIPE_TEST_SECRET_KEY: 'sk_test_browser_fixture',
    STRIPE_TEST_WEBHOOK_SECRET: 'whsec_browser_fixture', SUPABASE_SERVICE_ROLE_KEY: 'service_role_browser_fixture',
    STRIPE_TEST_SUPABASE_URL: 'http://127.0.0.1:54399' },
});
const stop = () => { child.kill(); server.close(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.on('exit', code => { server.close(); process.exitCode = code ?? 0; });
let addressRows=[],orderRows=[],conversationRows=[],messageRows=[],eventRows=[];


