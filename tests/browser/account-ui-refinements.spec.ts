import { expect, test, type Page } from "@playwright/test";

const state = "http://127.0.0.1:54399/_test/state";
const labels = ["Won Auctions", "Sold Auctions", "Messages", "Delivery Addresses"];

async function signIn(page: Page, email = "one@example.test") {
  await page.goto("/login?next=/account/addresses");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fixturepassword");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delivery Addresses", exact: true })).toBeVisible();
}

async function fillAddress(page: Page, recipient: string) {
  for (const [label, value] of [["Full recipient name", recipient], ["Address line 1", "10 Example Road"], ["Town / city", "London"], ["Postcode", "SW1A 1AA"], ["Country", "United Kingdom"], ["Delivery instructions", "Use the side entrance"]]) {
    await page.getByLabel(label, { exact: false }).fill(value);
  }
}

for (const width of [320, 390, 768, 1440]) {
  test(`continuous room photographs and compact footer at ${width}px`, async ({ page, request }) => {
    await request.post(state, { data: { mode: "empty" } });
    await request.post(state, { data: { mode: "gallery" } });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const cards = page.locator("aside a.group");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().getByTestId("room-status-footer")).toContainText(/preview/i);
    await expect(cards.last().getByTestId("room-status-footer")).toContainText(/waiting/i);
    expect(await cards.evaluateAll(nodes => nodes.every(card => {
      const image = card.querySelector("img")!;
      const footer = card.querySelector('[data-testid="room-status-footer"]')!;
      const photo = image.getBoundingClientRect(), status = footer.getBoundingClientRect();
      const alpha = Number(getComputedStyle(footer).backgroundColor.match(/[\d.]+/g)?.[3] ?? 1);
      return image.complete && image.naturalWidth > 0 && photo.top <= status.top && photo.bottom >= status.bottom && alpha < 0.3;
    }))).toBe(true);
    const footer = page.locator("footer");
    await expect(footer.getByRole("navigation", { name: "Policies" }).getByRole("link")).toHaveCount(6);
    await expect(footer.getByRole("link", { name: "Sell an Item", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "My Auctions", exact: true })).toHaveCount(0);
    expect(await footer.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(width >= 1024 ? 230 : 360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await cards.first().screenshot({ path: `test-results/room-card-${width}.png` });
    await footer.screenshot({ path: `test-results/footer-${width}.png` });
  });
}

test("all six original policy PDFs and the single generated favicon are served", async ({ page, request }) => {
  await request.post(state, { data: { mode: "empty" } });
  await page.goto("/");
  const files = ["terms-and-conditions", "privacy-policy", "cookie-policy", "returns-refunds-policy", "seller-policy", "prohibited-items-policy"];
  const links = page.locator('footer a[href$=".pdf"]');
  expect((await links.evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).sort()).toEqual(files.map(file => `/policies/${file}.pdf`).sort());
  for (const file of files) {
    const response = await request.get(`/policies/${file}.pdf`);
    expect(response.ok()).toBe(true);
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }
  const icons = page.locator('head link[rel="icon"]');
  await expect(icons).toHaveCount(1);
  const response = await request.get((await icons.getAttribute("href"))!);
  expect(response.ok()).toBe(true);
  const ico = await response.body();
  expect(ico.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  expect(ico.readUInt16LE(4)).toBe(5);
});

for (const width of [320, 1280]) {
  test(`account navigation and persistent address management at ${width}px`, async ({ page, request, browser }) => {
    test.setTimeout(60000);
    await request.post(state, { data: { mode: "transactions" } });
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "My account", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Won Auctions", exact: true })).toBeHidden();
    await expect(header.locator("summary")).toHaveAccessibleName("Account options");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nav = page.getByRole("navigation", { name: "My Account", exact: true });
    await header.locator("summary").click();
    expect(await header.getByRole("navigation", { name: "Account settings" }).getByRole("link").allTextContents()).toEqual(labels);
    await header.locator("summary").click();
    await header.getByRole("link", { name: "My account", exact: true }).click();
    await expect(page).toHaveURL(/\/my-auctions$/);
    await nav.getByRole("link", { name: "Delivery Addresses", exact: true }).click();
    expect(await nav.getByRole("link").allTextContents()).toEqual(labels);
    await expect(nav.getByRole("link", { name: "Delivery Addresses" })).toHaveAttribute("aria-current", "page");
    await fillAddress(page, "Home recipient");
    await page.getByLabel("Default delivery address", { exact: true }).check();
    await page.getByRole("button", { name: "Save address", exact: true }).click();
    const home = page.getByRole("article", { name: "Address for Home recipient", exact: true });
    await expect(home).toContainText("Default");
    await fillAddress(page, "Work recipient");
    await page.getByRole("button", { name: "Save address", exact: true }).click();
    const work = page.getByRole("article", { name: "Address for Work recipient", exact: true });
    await expect(work).toBeVisible();
    await work.getByRole("button", { name: "Set default", exact: true }).click();
    await expect(work).toContainText("Default");
    await expect(home).not.toContainText("Default");
    await page.reload();
    await expect(work).toContainText("Default");
    await work.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await expect(page.getByLabel("Default delivery address", { exact: true })).not.toBeChecked();
    await work.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Address line 1", { exact: false }).fill("20 Updated Road");
    await page.getByRole("button", { name: "Save address", exact: true }).click();
    await expect(work).toContainText("20 Updated Road");
    await home.getByRole("button", { name: "Delete saved address", exact: true }).click();
    await expect(home).toHaveCount(0);
    await nav.getByRole("link", { name: "Won Auctions", exact: true }).click();
    await expect(page.locator("#won-auctions")).toBeVisible();
    await nav.getByRole("link", { name: "Sold Auctions", exact: true }).click();
    await expect(page.locator("#sold-auctions")).toBeVisible();
    await nav.getByRole("link", { name: "Messages", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Conversations", exact: true }).getByRole("link").first()).toBeVisible();
    await page.getByRole("navigation", { name: "Conversations", exact: true }).getByRole("link").first().click();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Delivery Addresses", exact: true }).click();
    await expect(work).toContainText("20 Updated Road");
    await page.screenshot({ path: `test-results/account-${width}.png`, fullPage: true });
    const otherDevice = await browser.newContext();
    try {
      const otherPage = await otherDevice.newPage();
      await signIn(otherPage);
      await expect(otherPage.getByRole("article", { name: "Address for Work recipient" })).toContainText("20 Updated Road");
      await otherPage.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(otherPage).toHaveURL(/\/login$/);
      await signIn(otherPage, "two@example.test");
      await expect(otherPage.getByRole("article")).toHaveCount(0);
      await expect(otherPage.getByText("20 Updated Road")).toHaveCount(0);
    } finally { await otherDevice.close(); }
  });
}
