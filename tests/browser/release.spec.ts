import { expect, test } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:54399/_test/state";
test.beforeEach(async ({ request }) => { await request.post(fixtureUrl, { data: { mode: "empty" } }); });

test("real empty rooms never show demo items and remain accessible", async ({ page }) => {
  const response = await page.goto("/rooms/general-room");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "No eligible lots right now" })).toBeVisible();
  await expect(page.getByText("Pear Shaped Diamond Pendant Necklace")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No eligible lots right now" })).toBeVisible();
});

test("mobile navigation works and auction content stays within narrow viewports", async ({ page, request }) => {
  await request.post(fixtureUrl, { data: { mode: "preview" } });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/rooms/general-room");
    await expect(page.getByRole("heading", { name: "Release test catalogue item" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const clippedControls = await page.evaluate(() => [...document.querySelectorAll('main button, main input')].filter(element => {
      let parent = element.parentElement;
      while (parent && parent.tagName !== 'MAIN') {
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) return false;
        parent = parent.parentElement;
      }
      const box = element.getBoundingClientRect(); return box.right > innerWidth || box.left < 0;
    }).map(element => element.textContent || element.id));
    expect(clippedControls).toEqual([]);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Sell", exact: true }).click();
  await expect(page).toHaveURL(/\/sell$/);
  await expect(page.getByRole("button", { name: "Seller submissions opening soon" })).toBeDisabled();
});

test("preview disables bidding and the existing login form submits safely", async ({ page, request }) => {
  await request.post(fixtureUrl, { data: { mode: "preview" } });
  await page.goto("/rooms/general-room");
  await expect(page.getByRole("button", { name: "Bidding Not Open" })).toBeDisabled();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("bidder@example.test");
  // Existing passwords are authenticated by Supabase, without a new signup-length restriction.
  await page.getByLabel("Password", { exact: true }).fill("short1");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Invalid login credentials");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText("Could not request a reset link. Please try again later.");
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/my-auctions");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a browser clock one minute ahead still displays the database countdown", async ({ page, request }) => {
  await page.addInitScript(() => { const original = Date.now; Date.now = () => original() + 60000; });
  await request.post(fixtureUrl, { data: { mode: "preview" } });
  await page.goto("/rooms/general-room");
  await expect(page.locator('span.font-mono').first()).toHaveText(/00:2[0-9]/);
});

test("a fresh bid resets the same five-second display and changing lots replaces the image", async ({ page, request }) => {
  await request.post(fixtureUrl, { data: { mode: "active" } });
  await page.goto("/rooms/general-room");
  const timer = page.locator('span.font-mono').first();
  await expect(timer).toHaveText(/00:0[1-3]/);
  await request.post(fixtureUrl, { data: { resetBid: true } });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText("2 bids", { exact: true }).first()).toBeVisible();
  await expect(timer).toHaveText(/00:0[4-5]/);
  await request.post(fixtureUrl, { data: { nextLot: true } });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole("heading", { name: "Next release test item" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Next release test item", exact: true })).toHaveAttribute("src", /view=two/);
});
