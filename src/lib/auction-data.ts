import { cache } from "react";
import { auctionLotColumns as lotColumns, roomColumns, imageColumns } from "@/lib/lot-columns";
import { unstable_noStore as noStore } from "next/cache";
import { resolveLotPhotos } from "@/lib/lot-photos";
import { getAuctionDataMode } from "@/lib/auction-mode";
import type { LiveLotCandidate } from "@/lib/live-viewers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getLotStatusLabel } from "@/lib/auction-lifecycle";
import {
  auctionRooms as mockAuctionRooms,
  getLotById as getMockLotById,
  getRoomLots as getMockRoomLots,
  lots as mockLots,
  type AuctionRoom as MockAuctionRoom,
  type Lot as MockLot,
} from "@/lib/mock-data";
import type {
  AuctionRoomRow,
  BidRow,
  Database,
  LotImageRow,
  LotRow,
  LotStatus,
} from "@/lib/supabase/types";

export type Lot = MockLot & {
  auctionStatus: LotStatus;
  endsAt?: string | null;
  nextEligibleAt?: string | null;
  winningBid?: number | null;
};

export type AuctionRoom = MockAuctionRoom & {
  slug: string;
  databaseId?: string;
  liveLot?: Lot;
};

type SupabaseReadClient = SupabaseClient<Database>;

type AuctionLotRow = Pick<LotRow, "id" | "room_id" | "title" | "description" | "condition_report" | "shipping_info" | "starting_bid" | "current_bid" | "bid_count" | "minimum_increment" | "preview_duration_seconds" | "status" | "starts_at" | "preview_starts_at" | "bidding_starts_at" | "ends_at" | "next_eligible_at" | "queue_position" | "winning_bid" | "is_premium" | "created_at">;

type SupabaseLotBundle = {
  lot: AuctionLotRow;
  room?: AuctionRoomRow;
  images: LotImageRow[];
  bids: BidRow[];
};

const visibleLotStatuses: LotStatus[] = [
  "WAITING",
  "PREVIEW",
  "FIRST_BID_WINDOW",
  "ACTIVE_BIDDING",
  "SOLD",
  "UNSOLD",
  "CANCELLED",
];

const upcomingLotStatuses: LotStatus[] = [
  "WAITING",
  "PREVIEW",
  "FIRST_BID_WINDOW",
  "ACTIVE_BIDDING",
  "UNSOLD",
];
const currentLotStatuses: LotStatus[] = ["PREVIEW", "FIRST_BID_WINDOW", "ACTIVE_BIDDING"];
const fallbackImageUrl = "/images/auction-house-background.png";

function isDemoMode() {
  return getAuctionDataMode({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    demoMode: process.env.AUCTION_DEMO_MODE,
  }) === "demo";
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return String(error);
}

function throwAuctionDataError(context: string, error: unknown): never {
  console.error(`[Auction data] ${context}:`, error);
  throw new Error(`${context}: ${getErrorMessage(error)}`);
}

function createSupabaseReadClient() {
  if (isDemoMode()) {
    return null;
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getSecondsUntil(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const target = new Date(value).getTime();
  const seconds = Math.ceil((target - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(seconds, 0) : fallback;
}

function getLotCountdownTarget(lot: AuctionLotRow) {
  if (lot.status === "UNSOLD") {
    return lot.next_eligible_at;
  }

  return lot.ends_at ?? lot.bidding_starts_at ?? lot.preview_starts_at ?? lot.starts_at;
}

function formatStartsIn(lot: AuctionLotRow) {
  if (lot.status === "PREVIEW" || lot.status === "FIRST_BID_WINDOW" || lot.status === "ACTIVE_BIDDING") {
    const seconds = getSecondsUntil(getLotCountdownTarget(lot), lot.preview_duration_seconds);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  if (lot.status === "UNSOLD") {
    return "Returned to queue";
  }

  if (lot.status === "WAITING") {
    return "Queued";
  }

  return getLotStatusLabel(lot.status);
}

function buildDetails(lot: AuctionLotRow, room?: AuctionRoomRow) {
  return [
    room?.name ?? "Auction lot",
    getLotStatusLabel(lot.status),
    lot.is_premium ? "Premium listing" : "Public listing",
  ];
}

function mapSupabaseLot(bundle: SupabaseLotBundle, lotNumber: number): Lot {
  const { lot, room, images, bids } = bundle;
  const availableImages = images.filter(image => image.image_url);
  const galleryImageUrls = availableImages.length
    ? availableImages.map((image) => image.image_url)
    : [room?.image_url ?? fallbackImageUrl];
  const startingBid = toNumber(lot.starting_bid);
  const rawCurrentBid = toNumber(lot.current_bid);
  const currentBid = rawCurrentBid > 0 ? rawCurrentBid : startingBid;
  const minimumIncrement = toNumber(lot.minimum_increment, 50);

  return {
    id: lot.id,
    lotNumber,
    roomId: room?.slug ?? lot.room_id,
    title: lot.title,
    category: room?.name ?? "Auction",
    maker: "Nonstop Auctions",
    details: buildDetails(lot, room),
    description: lot.description ?? "No description has been added yet.",
    conditionReport: lot.condition_report ?? "Condition report pending.",
    shippingInfo: lot.shipping_info ?? "Shipping details will be confirmed before checkout.",
    imageUrl: galleryImageUrls[0],
    thumbnailUrl: galleryImageUrls[0],
    galleryImageUrls,
    estimateLow: startingBid,
    estimateHigh: startingBid,
    startingBid,
    currentBid,
    bidCount: toNumber(lot.bid_count, bids.length),
    winningBid: lot.winning_bid == null ? null : toNumber(lot.winning_bid),
    countdownSeconds: getSecondsUntil(getLotCountdownTarget(lot), lot.preview_duration_seconds),
    minimumIncrement,
    startsIn: formatStartsIn(lot),
    auctionStatus: lot.status,
    endsAt: lot.ends_at,
    nextEligibleAt: lot.next_eligible_at,
  };
}

function mapSupabaseRoom(room: AuctionRoomRow, liveLot?: Lot): AuctionRoom {
  return {
    id: room.slug,
    slug: room.slug,
    databaseId: room.id,
    name: room.name,
    strapline: room.description ?? "Live auctions. Exceptional pieces.",
    category: room.name,
    imageUrl: room.image_url ?? liveLot?.imageUrl ?? fallbackImageUrl,
    liveLotId: liveLot?.id ?? "",
    currentBid: liveLot?.currentBid ?? 0,
    bidCount: liveLot?.bidCount ?? 0,
    liveLot,
  };
}

function getMockAuctionRooms(): AuctionRoom[] {
  return mockAuctionRooms.map((room) => {
    const liveLot = getMockLotById(room.liveLotId);

    return {
      ...room,
      slug: room.id,
      liveLot,
    };
  });
}

function getMockRoomBySlug(roomSlug: string) {
  return getMockAuctionRooms().find((room) => room.slug === roomSlug || room.id === roomSlug);
}

async function fetchLotImages(client: SupabaseReadClient, lotIds: string[]) {
  if (!lotIds.length) {
    return new Map<string, LotImageRow[]>();
  }

  const { data, error } = await client
    .from("lot_images")
    .select(imageColumns)
    .in("lot_id", lotIds)
    .order("sort_order", { ascending: true });

  if (error || !data) {
    if (error) {
      console.error("[Auction data] Could not load lot images:", error);
    }
    return new Map<string, LotImageRow[]>();
  }

  const resolved = await resolveLotPhotos(client, data);
  return resolved.reduce((imagesByLotId, image) => {
    const lotImages = imagesByLotId.get(image.lot_id) ?? [];
    lotImages.push(image);
    imagesByLotId.set(image.lot_id, lotImages);
    return imagesByLotId;
  }, new Map<string, LotImageRow[]>());
}

// React cache is scoped to a server render. Mutable auction data is never shared
// across requests; this only removes duplicate metadata requests within a render.
const getActiveRoomRows = cache(async () => {
  const client = createSupabaseReadClient();
  if (!client) return [];
  const { data, error } = await client.from("auction_rooms").select(roomColumns)
    .eq("is_active", true).order("display_order").order("created_at").order("id");
  if (error) throwAuctionDataError("Could not load auction rooms", error);
  return data ?? [];
});

type RoomAuctionState = {
  currentLot: Lot | null;
  upcomingLots: Lot[];
};

async function fetchSupabaseRoomAuctionState(
  roomSlug: string,
  excludeLotId?: string,
  limit = 5,
): Promise<RoomAuctionState | null> {
  noStore();
  const client = createSupabaseReadClient();

  if (!client) {
    return null;
  }

  const room = (await getActiveRoomRows()).find(room => room.slug === roomSlug || room.id === roomSlug);
  if (!room) return null;

  const { data: advancedLot, error: lifecycleError } = await client.rpc("advance_room_lifecycle", {
    p_room_id: room.id,
  });
  if (lifecycleError) throwAuctionDataError(`Could not advance auction room ${roomSlug}`, lifecycleError);
  // The authoritative RPC already returns the current lot; do not query it again.
  const currentLotRow = advancedLot?.id && currentLotStatuses.includes(advancedLot.status) ? advancedLot : null;

  const excludedId = excludeLotId ?? currentLotRow?.id;
  let upcomingQuery = client
    .from("lots")
    .select(lotColumns)
    .eq("room_id", room.id)
    .in("status", upcomingLotStatuses)
    .order("queue_position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }).limit(limit);

  if (excludedId) {
    upcomingQuery = upcomingQuery.neq("id", excludedId);
  }

  const { data: upcomingRows, error: upcomingError } = await upcomingQuery;

  if (upcomingError || !upcomingRows) {
    if (upcomingError) {
      throwAuctionDataError(`Could not load upcoming lots for ${roomSlug}`, upcomingError);
    }
    return null;
  }

  const sourceRows = Array.from(
    new Map(
      [currentLotRow, ...upcomingRows]
        .filter((lot): lot is AuctionLotRow => Boolean(lot))
        .map((lot) => [lot.id, lot]),
    ).values(),
  );
  const lotIds = sourceRows.map((lot) => lot.id);
  const imagesByLotId = await fetchLotImages(client, lotIds);
  const bidsByLotId = new Map<string, BidRow[]>();
  const mappedLots = sourceRows.map((lot, index) =>
    mapSupabaseLot(
      {
        lot,
        room,
        images: imagesByLotId.get(lot.id) ?? [],
        bids: bidsByLotId.get(lot.id) ?? [],
      },
      lot.queue_position > 0 ? lot.queue_position : index + 1,
    ),
  );
  const mappedById = new Map(mappedLots.map((lot) => [lot.id, lot]));

  return {
    currentLot: currentLotRow ? mappedById.get(currentLotRow.id) ?? null : null,
    upcomingLots: upcomingRows
      .map((lot) => mappedById.get(lot.id))
      .filter((lot): lot is Lot => Boolean(lot)),
  };
}

async function getRoomAuctionState(
  roomSlug: string,
  excludeLotId?: string,
  limit = 5,
): Promise<RoomAuctionState | null> {
  const supabaseState = await fetchSupabaseRoomAuctionState(roomSlug, excludeLotId, limit);

  if (supabaseState) {
    return supabaseState;
  }
  if (!isDemoMode()) return null;

  const mockRoom = getMockRoomBySlug(roomSlug);

  if (!mockRoom) {
    return null;
  }

  const currentLot = mockRoom.liveLot ?? null;
  const excludedId = excludeLotId ?? currentLot?.id;

  return {
    currentLot,
    upcomingLots: getMockRoomLots(mockRoom.id)
      .filter((lot) => lot.id !== excludedId)
      .filter((lot) => upcomingLotStatuses.includes(lot.auctionStatus))
      .slice(0, limit),
  };
}

export const getAuctionRooms = cache(async (): Promise<AuctionRoom[]> => {
  noStore();
  const client = createSupabaseReadClient();
  if (!client) return getMockAuctionRooms();
  const [rooms, current] = await Promise.all([
    getActiveRoomRows(),
    client.from("lots").select(lotColumns).in("status", currentLotStatuses),
  ]);
  if (current.error) throwAuctionDataError("Could not load current room lots", current.error);
  const images = await fetchLotImages(client, (current.data ?? []).map(lot => lot.id));
  const byRoom = new Map((current.data ?? []).map(lot => [lot.room_id, lot]));
  return rooms.map(room => {
    const lot = byRoom.get(room.id);
    return mapSupabaseRoom(room, lot ? mapSupabaseLot({ lot, room, images: images.get(lot.id) ?? [], bids: [] }, lot.queue_position || 1) : undefined);
  });
});

// Read-only: navigation never calls lifecycle or bidding functions.
export async function getActiveLotCandidates(): Promise<LiveLotCandidate[]> {
  noStore();
  const client = createSupabaseReadClient();
  if (!client) return [];
  const [{ data: rooms, error: roomError }, { data: lots, error: lotError }] = await Promise.all([
    client.from("auction_rooms").select("id,slug,display_order").eq("is_active", true),
    client.from("lots").select("id,room_id").in("status", currentLotStatuses),
  ]);
  if (roomError || lotError) throwAuctionDataError("Could not load live navigation", roomError ?? lotError);
  const byId = new Map((rooms ?? []).map((room) => [room.id, room]));
  return (lots ?? []).flatMap((lot) => {
    const room = byId.get(lot.room_id);
    return room ? [{ id: lot.id, roomSlug: room.slug, roomOrder: room.display_order }] : [];
  });
}

export async function getLiveLotByRoomSlug(roomSlug: string) {
  noStore();
  const state = await getRoomAuctionState(roomSlug);
  return state?.currentLot ?? null;
}

export async function getUpcomingLotsByRoomSlug(roomSlug: string) {
  noStore();
  const state = await getRoomAuctionState(roomSlug);
  return state?.upcomingLots ?? [];
}

export async function getLotById(lotId: string) {
  noStore();
  if (isDemoMode()) return getMockLotById(lotId) ?? null;
  const client = await createSupabaseServerClient();
  const { data: lot, error } = await client.from("lots").select(lotColumns).eq("id", lotId).maybeSingle();
  if (error) throwAuctionDataError("Could not load lot", error);
  if (!lot) return null;
  const [{ data: room }, images] = await Promise.all([
    client.from("auction_rooms").select(roomColumns).eq("id", lot.room_id).maybeSingle(),
    fetchLotImages(client, [lotId]),
  ]);
  return mapSupabaseLot({ lot, room: room ?? undefined, images: images.get(lotId) ?? [], bids: [] }, lot.queue_position || 1);
}

export async function getBidsByLotId(lotId: string) {
  noStore();
  if (!createSupabaseReadClient()) return [];
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];

  const { data, error } = await client
    .from("bids")
    .select("*")
    .eq("lot_id", lotId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    if (error) {
      console.error(`[Auction data] Could not load bids for lot ${lotId}:`, error);
    }
    return [];
  }

  return data;
}

export async function getLotsByIds(ids: string[]): Promise<Lot[]> {
  if (!ids.length) return [];
  noStore();
  const client = createSupabaseReadClient();
  if (!client) return mockLots.filter(lot => ids.includes(lot.id));
  const [rooms, result] = await Promise.all([
    getActiveRoomRows(),
    client.from("lots").select(lotColumns).in("id", ids).in("status", visibleLotStatuses)
      .order("queue_position").order("created_at").order("id"),
  ]);
  if (result.error) throwAuctionDataError("Could not load watched lots", result.error);
  const byRoom = new Map(rooms.map(room => [room.id, room]));
  const rows = (result.data ?? []).filter(lot => byRoom.has(lot.room_id));
  const images = await fetchLotImages(client, rows.map(lot => lot.id));
  return rows.map((lot, index) => mapSupabaseLot({ lot, room: byRoom.get(lot.room_id), images: images.get(lot.id) ?? [], bids: [] }, lot.queue_position || index + 1));
}

export function getStaticRoomParams() {
  return mockAuctionRooms.map((room) => ({ roomId: room.id }));
}

export function getStaticLotParams() {
  return mockLots.map((lot) => ({ lotId: lot.id }));
}

export async function getHomeAuctionData() {
  noStore();
  const [rooms, state] = await Promise.all([getAuctionRooms(), getRoomAuctionState("general-room")]);
  const activeRoom = rooms.find((room) => room.slug === "general-room") ?? null;
  const currentLot = state?.currentLot ?? null;

  return {
    rooms,
    activeRoom,
    currentLot,
    roomCurrentLot: currentLot,
    upcomingLots: state?.upcomingLots ?? [],
  };
}

export async function getRoomAuctionData(roomSlug: string) {
  noStore();
  const [rooms, state] = await Promise.all([getAuctionRooms(), getRoomAuctionState(roomSlug)]);
  const activeRoom = rooms.find((room) => room.slug === roomSlug || room.id === roomSlug) ?? null;

  if (!activeRoom) {
    return null;
  }

  const currentLot = state?.currentLot ?? null;

  return {
    rooms,
    activeRoom,
    currentLot,
    roomCurrentLot: currentLot,
    upcomingLots: state?.upcomingLots ?? [],
  };
}

export async function getLotAuctionData(lotId: string) {
  noStore();
  const [currentLot, rooms] = await Promise.all([getLotById(lotId), getAuctionRooms()]);

  if (!currentLot) {
    return null;
  }

  let activeRoom = rooms.find((room) => room.slug === currentLot.roomId || room.id === currentLot.roomId) ?? null;
  if (!activeRoom && !isDemoMode()) {
    const client = await createSupabaseServerClient();
    const { data: room } = await client.from("auction_rooms").select(roomColumns).eq("slug", currentLot.roomId).maybeSingle();
    if (room) activeRoom = mapSupabaseRoom(room);
  }

  if (!activeRoom) {
    return null;
  }

  const state = rooms.some(room => room.id === activeRoom.id) ? await getRoomAuctionState(
    activeRoom.slug ?? activeRoom.id,
    currentLot.id,
  ) : null;

  // The RPC may have completed the displayed lot while advancing the room.
  // Re-read only in that case; otherwise use the RPC's fresh row or the stable
  // historical record instead of fetching/signing the same gallery twice.
  const displayedLot = state?.currentLot?.id === lotId ? state.currentLot
    : currentLotStatuses.includes(currentLot.auctionStatus) ? await getLotById(lotId) : currentLot;
  return {
    rooms,
    activeRoom,
    currentLot: displayedLot,
    roomCurrentLot: state?.currentLot ?? null,
    upcomingLots: state?.upcomingLots ?? [],
  };
}
