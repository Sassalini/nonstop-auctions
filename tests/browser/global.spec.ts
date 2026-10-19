import { expect, test } from "@playwright/test";
import { RealtimeFixture } from "../helpers/realtime-fixture";

const fixture = 'http://127.0.0.1:54399/_test/state';
const hall = '20000000-0000-0000-0000-000000000701';
const jewellery = '20000000-0000-0000-0000-000000000101';
const accountA = '00000000-0000-0000-0000-000000000102';

test.beforeEach(async ({ request }) => { await request.post(fixture, { data: { mode: 'empty' } }); await request.post(fixture, { data: { mode: 'global' } }); });

test('homepage stays in Grand Hall with its queue and fixed brighter background, even when empty', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Release test catalogue item' })).toBeVisible();
  await expect(page.locator('aside a.group[href="/rooms/general-room"]')).toHaveClass(/border-auction-gold\/70/);
  await expect(page.getByRole('heading', { name: 'Grand Hall queued lot' })).toBeVisible();
  expect(await page.locator('.site-background').evaluate(element => ({ position: getComputedStyle(element).position, filter: getComputedStyle(element).filter })))
    .toEqual({ position: 'fixed', filter: 'brightness(1.05)' });
  await request.post(fixture, { data: { hallEmpty: true } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No auctions currently available' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jewellery fixture lot', exact: true })).toHaveCount(0);
  await expect(page.locator('aside a.group[href="/rooms/general-room"]')).toHaveClass(/border-auction-gold\/70/);
});

test('Presence spans simultaneous browser sessions, survives reload/reconnect, deduplicates tabs and updates Live', async ({ browser, request }) => {
  const hub = new RealtimeFixture();
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) await hub.attach(context);
    const [a,b,c] = await Promise.all(contexts.map(context => context.newPage()));
    await a.goto(`/lots/${hall}`);
    await expect(a.getByTestId('live-viewer-count')).toHaveText('1 viewers');
    await b.goto(`/lots/${jewellery}`);
    await c.goto(`/lots/${jewellery}`);
    await expect(b.getByTestId('live-viewer-count')).toHaveText('2 viewers');
    await expect(c.getByTestId('live-viewer-count')).toHaveText('2 viewers');
    await expect(a.locator('header nav').getByRole('link', { name: 'Live', exact: true })).toHaveAttribute('href', `/lots/${jewellery}`);
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a.screenshot({ path: 'test-results/global-live-audience.png' });
    await expect(a.getByTestId('watchlist-count')).toHaveText('2 watching');
    await c.reload();
    await expect(c.getByTestId('live-viewer-count')).toHaveText('2 viewers');
    await c.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(b.getByTestId('live-viewer-count')).toHaveText('1 viewers');
    await c.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(b.getByTestId('live-viewer-count')).toHaveText('2 viewers');
    const tab = await contexts[0].newPage();
    await tab.goto(`/lots/${hall}`);
    await expect(tab.getByTestId('live-viewer-count')).toHaveText('1 viewers');
    await tab.close();
    await c.close();
    await expect(b.getByTestId('live-viewer-count')).toHaveText('1 viewers');
    await expect(a.locator('header nav').getByRole('link', { name: 'Live', exact: true })).toHaveAttribute('href', `/lots/${hall}`);
    hub.disconnect();
    await expect(a.getByTestId('live-viewer-count')).toHaveText('1 viewers', { timeout: 15000 });
    await expect(b.getByTestId('live-viewer-count')).toHaveText('1 viewers', { timeout: 15000 });
    await request.post(fixture, { data: { retireHall: true } });
    hub.emit('lots', { id: hall, room_id: '10000000-0000-0000-0000-000000000007', status: 'SOLD' });
    await expect(a.locator('header nav').getByRole('link', { name: 'Live', exact: true })).toHaveAttribute('href', `/lots/${jewellery}`);
    await b.goto('/sell');
    await expect(a.locator('header nav').getByRole('link', { name: 'Live', exact: true })).toHaveAttribute('href', `/lots/${jewellery}`);
    await request.post(fixture, { data: { mode: 'empty' } });
    hub.emit('lots');
    await expect(a.locator('header nav').getByRole('link', { name: 'Live', exact: true })).toHaveAttribute('href', '/live');
    await a.locator('header nav').getByRole('link', { name: 'Live', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Waiting for the next live lot' })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});

test('room advancement changes Presence to the newly displayed lot and mobile Live uses the same winner', async ({ context, page, request }) => {
  const hub = new RealtimeFixture(); await hub.attach(context);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/rooms/general-room');
  await expect(page.getByTestId('live-viewer-count')).toHaveText('1 viewers');
  await request.post(fixture, { data: { nextLot: true } });
  hub.emit('lots', { id: hall, room_id: '10000000-0000-0000-0000-000000000007', status: 'SOLD' });
  await expect(page.getByRole('heading', { name: 'Next release test item' })).toBeVisible();
  await expect(page.getByTestId('live-viewer-count')).toHaveText('1 viewers');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Live', exact: true }))
    .toHaveAttribute('href', '/lots/20000000-0000-0000-0000-000000000702');
});

test('notification bell is account-specific, marks read, opens lots and refetches missed events on reconnect', async ({ browser, request }) => {
  const hub = new RealtimeFixture();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) await hub.attach(context);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (let i=0;i<pages.length;i++) {
      const page = pages[i];
      await page.goto('/login');
      await page.getByLabel('Email', { exact: true }).fill(`${i ? 'two' : 'one'}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('fixturepassword');
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Account notifications' });
      await expect(panel.getByText(`Private account ${i ? 'two' : 'one'} item`, { exact: true })).toBeVisible();
      await expect(panel.getByText(`Private account ${i ? 'one' : 'two'} item`, { exact: true })).toHaveCount(0);
    }
    const [a,b] = pages;
    await a.getByRole('button', { name: 'Mark all read' }).click();
    await expect(a.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(b.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible();
    await a.getByRole('region', { name: 'Account notifications' }).getByRole('link').first().click();
    await expect(a).toHaveURL(new RegExp(`/won-auctions\\?lot=${hall}#${hall}$`));
    await a.goto(`/lots/${hall}`);
    await expect(a.getByTestId('watchlist-count')).toHaveText('2 watching');
    await a.getByRole('button', { name: 'Watching', exact: true }).click();
    await expect(a.getByTestId('watchlist-count')).toHaveText('1 watching');
    const realtimeNotification = {
      id: '40000000-0000-0000-0000-000000000104', user_id: accountA, lot_id: hall, kind: 'SELLER_LIVE', lot_title: 'Realtime seller update',
    };
    await request.post(fixture, { data: { notification: realtimeNotification } });
    hub.emit('notifications', realtimeNotification);
    await expect(a.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible();
    await expect(b.getByText('Realtime seller update', { exact: true })).toHaveCount(0);
    await a.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
    await expect(a.getByText('Realtime seller update', { exact: true })).toBeVisible();
    for (const width of [320, 375, 1440]) {
      await a.setViewportSize({ width, height: width >= 1000 ? 1000 : 812 });
      expect(await a.getByRole('region', { name: 'Account notifications' }).evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
      if (width !== 320) await a.screenshot({ path: `test-results/global-notifications-${width}.png` });
    }
    await a.getByRole('button', { name: 'Mark notification for Realtime seller update as read' }).click();
    await expect(a.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Close notifications' }).click();
    hub.disconnect();
    await request.post(fixture, { data: { notification: {
      id: '40000000-0000-0000-0000-000000000103', user_id: accountA, lot_id: hall, kind: 'WATCHED_LIVE', lot_title: 'Missed while disconnected',
    } } });
    await expect(a.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible({ timeout: 15000 });
    await a.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
    await expect(a.getByText('Missed while disconnected', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Close notifications' }).click();
    await a.getByRole('button', { name: 'Sign out', exact: true }).click();
    await a.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(a.getByText('Missed while disconnected', { exact: true })).toHaveCount(0);
    await expect(a.getByRole('region', { name: 'Account notifications' }).getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});
