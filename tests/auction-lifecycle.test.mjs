import assert from "node:assert/strict";
import test from "node:test";
import {
  getLotCompactStatusLabel,
  getLotStatusLabel,
  getLotTimerLabel,
  getMinimumAcceptedBid,
  isBiddingOpen,
} from "../src/lib/auction-lifecycle.ts";
import { getLifecycleSyncDelayMs } from "../src/lib/auction-sync.ts";

test("preview remains read-only and first-bid mode unlocks bidding", () => {
  assert.equal(isBiddingOpen("PREVIEW"), false);
  assert.equal(isBiddingOpen("FIRST_BID_WINDOW"), true);
  assert.equal(isBiddingOpen("ACTIVE_BIDDING"), true);
  assert.equal(isBiddingOpen("SOLD"), false);
  assert.equal(isBiddingOpen("UNSOLD"), false);
});

test("phase labels match the live auction contract", () => {
  assert.equal(getLotStatusLabel("PREVIEW"), "Preview period");
  assert.equal(getLotTimerLabel("PREVIEW"), "Bidding starts in");
  assert.equal(getLotStatusLabel("FIRST_BID_WINDOW"), "Bidding open");
  assert.equal(getLotTimerLabel("FIRST_BID_WINDOW"), "First bid closes in");
  assert.equal(getLotStatusLabel("ACTIVE_BIDDING"), "Live");
  assert.equal(getLotCompactStatusLabel("ACTIVE_BIDDING"), "Live");
  assert.equal(getLotTimerLabel("ACTIVE_BIDDING"), "Time remaining");
  assert.equal(getLotCompactStatusLabel("UNSOLD"), "Returned");
});

test("minimum bids distinguish the first bid from later increments", () => {
  assert.equal(
    getMinimumAcceptedBid({
      auctionStatus: "FIRST_BID_WINDOW",
      currentBid: 100,
      minimumIncrement: 10,
      startingBid: 100,
    }),
    100,
  );
  assert.equal(
    getMinimumAcceptedBid({
      auctionStatus: "ACTIVE_BIDDING",
      currentBid: 100,
      minimumIncrement: 10,
      startingBid: 100,
    }),
    110,
  );
});

test("deadline synchronization wakes only timed lifecycle phases", () => {
  assert.equal(getLifecycleSyncDelayMs("PREVIEW", 0), 250);
  assert.equal(getLifecycleSyncDelayMs("FIRST_BID_WINDOW", 10), 10250);
  assert.equal(getLifecycleSyncDelayMs("ACTIVE_BIDDING", 5), 5250);
  assert.equal(getLifecycleSyncDelayMs("SOLD", 0), null);
  assert.equal(getLifecycleSyncDelayMs("UNSOLD", 0), null);
});
