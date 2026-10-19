import { expect, test, type Page } from "@playwright/test";
import { RealtimeFixture } from "../helpers/realtime-fixture";

const fixture = 'http://127.0.0.1:54399/_test/state';
const roomId = '10000000-0000-0000-0000-000000000007';
const first = '20000000-0000-0000-0000-000000000701';
const next = '20000000-0000-0000-0000-000000000702';
const third = '20000000-0000-0000-0000-000000000703';
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
const toggle = (page: Page) => page.getByRole('switch', { name: 'Auto-play', exact: true });

test.beforeEach(async ({ request }) => {
  await request.post(fixture, { data: { mode: 'empty' } });
  await request.post(fixture, { data: { mode: 'sequence' } });
});

test('on follows a completed lot into the next 30-second preview and recovers missed advancement', async ({ context, page, request }) => {
  const hub = new RealtimeFixture(); await hub.attach(context);
  await page.goto(`/lots/${first}`);
  await expect(heading(page, 'Sequence current lot')).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  hub.disconnect();
  await request.post(fixture, { data: { sequenceResult: 'SOLD' } });
  await expect(heading(page, 'Next sequence lot')).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(new RegExp(`/lots/${next}$`));
  await expect(page.getByRole('button', { name: 'Bidding Not Open' })).toBeDisabled();
  await expect(page.locator('span.font-mono').first()).toHaveText(/00:2[0-9]/);
  await expect(page.locator('aside a.group[href="/rooms/general-room"]')).toHaveClass(/border-auction-gold\/70/);
});

for (const width of [375,1440]) {
  test(`off holds the final sold result at ${width}px; manual selection stays off and keyboard re-enabling rejoins`, async ({ context, page, request }) => {
    const hub = new RealtimeFixture(); await hub.attach(context);
    await page.setViewportSize({ width, height: width > 1000 ? 1000 : 812 });
    await page.goto('/rooms/general-room');
    await expect(heading(page, 'Sequence current lot')).toBeVisible();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page).toHaveURL(new RegExp(`/lots/${first}$`));
    await request.post(fixture, { data: { sequenceResult: 'SOLD' } });
    hub.emit('lots', { id: first, room_id: roomId, status: 'SOLD' });
    await expect(page.getByText("Auto-play is off. You are viewing this lot's final result.")).toBeVisible();
    await expect(heading(page, 'Sequence current lot')).toBeVisible();
    await expect(page.getByText('Auction price', { exact: true })).toBeVisible();
    await expect(page.getByText('Sold for: £250', { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/lots/${first}$`));
    await page.screenshot({ path: `test-results/auto-play-off-${width}.png`, fullPage: width < 1000 });
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(heading(page, 'Sequence current lot')).toBeVisible();
    await page.getByRole('link', { name: 'View Current Live Lot', exact: true }).click();
    await expect(heading(page, 'Next sequence lot')).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('link').filter({ has: page.getByRole('heading', { level: 3, name: 'Third sequence lot', exact: true }) }).click();
    await expect(heading(page, 'Third sequence lot')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/lots/${third}$`));
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await toggle(page).focus(); await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(heading(page, 'Next sequence lot')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/lots/${next}$`));
  });
}

test('switching on while viewing a completed lot immediately rejoins the selected room', async ({ context, page, request }) => {
  const hub = new RealtimeFixture(); await hub.attach(context);
  await page.goto(`/lots/${first}`);
  await toggle(page).click();
  await request.post(fixture, { data: { sequenceResult: 'SOLD' } });
  hub.emit('lots', { id: first, room_id: roomId, status: 'SOLD' });
  await expect(page.getByRole('link', { name: 'View Current Live Lot', exact: true })).toBeVisible();
  await toggle(page).click();
  await expect(heading(page, 'Next sequence lot')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/lots/${next}$`));
});

test('no-bid completion stays UNSOLD with starting bid and immediate queue return', async ({ context, page, request }) => {
  await request.post(fixture, { data: { mode: 'sequence', status: 'FIRST_BID_WINDOW' } });
  const hub = new RealtimeFixture(); await hub.attach(context);
  await page.goto(`/lots/${first}`); await toggle(page).click();
  await request.post(fixture, { data: { sequenceResult: 'UNSOLD' } });
  hub.emit('lots', { id: first, room_id: roomId, status: 'UNSOLD' });
  await expect(heading(page, 'Sequence current lot')).toBeVisible();
  await expect(page.getByText('Starting bid: £100', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No bids — returned to queue', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/lots/${first}$`));
  const response = await request.get(`http://127.0.0.1:54399/rest/v1/lots?id=eq.${first}`);
  const [lot] = await response.json();
  expect(Math.abs(Date.parse(lot.next_eligible_at) - Date.parse(lot.unsold_at))).toBeLessThan(1000);
  expect(lot.winning_bid).toBeNull(); expect(lot.highest_bidder_id).toBeNull();
});

test('independent visitors follow or stay without changing the room auction or one another', async ({ browser, request }) => {
  const hub = new RealtimeFixture();
  const contexts = await Promise.all([browser.newContext(),browser.newContext()]);
  try {
    for (const context of contexts) await hub.attach(context);
    const [following,staying] = await Promise.all(contexts.map(context => context.newPage()));
    await following.goto(`/lots/${first}`); await staying.goto(`/lots/${first}`);
    await toggle(staying).click();
    await expect(toggle(following)).toHaveAttribute('aria-checked','true');
    const before = await request.get('http://127.0.0.1:54399/rest/v1/lots');
    expect((await before.json())[0].status).toBe('ACTIVE_BIDDING');
    await request.post(fixture, { data: { sequenceResult: 'SOLD' } });
    hub.emit('lots', { id: first, room_id: roomId, status: 'SOLD' });
    await expect(heading(following, 'Next sequence lot')).toBeVisible();
    await expect(staying.getByRole('link', { name: 'View Current Live Lot', exact: true })).toBeVisible();
    await expect(heading(staying, 'Sequence current lot')).toBeVisible();
    await expect(toggle(staying)).toHaveAttribute('aria-checked','false');
    await expect(toggle(following)).toHaveAttribute('aria-checked','true');
  } finally { for (const context of contexts) await context.close(); }
});

test('rooms emptied after cleanup show no mock or returned lots while retaining the room sidebar', async ({ page, request }) => {
  await request.post(fixture, { data: { mode: 'empty' } });
  await page.goto('/');
  await expect(heading(page,'No auctions currently available')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Grand Hall', exact: true })).toBeVisible();
  await expect(page.getByText('Returned', { exact: true })).toHaveCount(0);
  await expect(heading(page,'Sequence current lot')).toHaveCount(0);
});
