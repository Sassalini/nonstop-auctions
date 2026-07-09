import { unstable_noStore as noStore } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatShortDateTime, getLotStatusLabel } from "@/lib/auction-lifecycle";
import {
  auctionRooms as mockAuctionRooms,
  getLiveLotForRoom as getMockLiveLotForRoom,
  getLotById as getMockLotById,
  getRoomLots as getMockRoomLots,
  liveLot as mockLiveLot,
  lots as mockLots,
  upcomingLots as mockUpcomingLots,
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
};

export type AuctionRoom = MockAuctionRoom & {
  slug: string;
  liveLot?: Lot;
};

type SupabaseReadClient = SupabaseClient<Database>;

type SupabaseLotBundle = {
  lot: LotRow;
  room?: AuctionRoomRow;
  images: LotImageRow[];
  bids: BidRow[];
};

type SupabaseSnapshot = {
  rooms: AuctionRoom[];
  lots: Lot[];
  bidRows: BidRow[];
  sourceLotsById: Map<string, LotRow>;
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
const fallbackImageUrl = mockLiveLot.imageUrl;

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function createSupabaseReadClient() {
  if (!hasSupabaseEnv()) {
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
  const seconds = Math.round((target - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(seconds, 0) : fallback;
}

function getLotCountdownTarget(lot: LotRow) {
  if (lot.status === "UNSOLD") {
    return lot.next_eligible_at;
  }

  return lot.ends_at ?? lot.bidding_starts_at ?? lot.preview_starts_at ?? lot.starts_at;
}

function formatStartsIn(lot: LotRow) {
  if (lot.status === "PREVIEW" || lot.status === "FIRST_BID_WINDOW" || lot.status === "ACTIVE_BIDDING") {
    const seconds = getSecondsUntil(getLotCountdownTarget(lot), lot.preview_duration_seconds);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  if (lot.status === "UNSOLD") {
    return lot.next_eligible_at ? formatShortDateTime(lot.next_eligible_at) : "Returned to queue";
  }

  if (lot.status === "WAITING") {
    return "Queued";
  }

  return getLotStatusLabel(lot.status);
}

function buildDetails(lot: LotRow, room?: AuctionRoomRow) {
  return [
    room?.name ?? "Auction lot",
    getLotStatusLabel(lot.status),
    lot.is_premium ? "Premium listing" : "Public listing",
  ];
}

function mapSupabaseLot(bundle: SupabaseLotBundle, lotNumber: number): Lot {
  const { lot, room, images, bids } = bundle;
  const galleryImageUrls = images.length
    ? images.map((image) => image.image_url)
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
    estimateLow: toNumber(lot.starting_bid),
    estimateHigh: Math.max(currentBid + minimumIncrement * 8, toNumber(lot.starting_bid)),
    startingBid,
    currentBid,
    bidCount: bids.length,
    watchers: 0,
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

function getMockHomeAuctionData() {
  const rooms = getMockAuctionRooms();

  return {
    rooms,
    activeRoom: rooms[0],
    currentLot: mockLiveLot,
    upcomingLots: mockUpcomingLots,
  };
}

async function fetchLotImages(client: SupabaseReadClient, lotIds: string[]) {
  if (!lotIds.length) {
    return new Map<string, LotImageRow[]>();
  }

  const { data, error } = await client
    .from("lot_images")
    .select("*")
    .in("lot_id", lotIds)
    .order("sort_order", { ascending: true });

  if (error || !data) {
    return new Map<string, LotImageRow[]>();
  }

  return data.reduce((imagesByLotId, image) => {
    const lotImages = imagesByLotId.get(image.lot_id) ?? [];
    lotImages.push(image);
    imagesByLotId.set(image.lot_id, lotImages);
    return imagesByLotId;
  }, new Map<string, LotImageRow[]>());
}

async function fetchBids(client: SupabaseReadClient, lotIds: string[]) {
  if (!lotIds.length) {
    return new Map<string, BidRow[]>();
  }

  const { data, error } = await client
    .from("bids")
    .select("*")
    .in("lot_id", lotIds)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return new Map<string, BidRow[]>();
  }

  return data.reduce((bidsByLotId, bid) => {
    const lotBids = bidsByLotId.get(bid.lot_id) ?? [];
    lotBids.push(bid);
    bidsByLotId.set(bid.lot_id, lotBids);
    return bidsByLotId;
  }, new Map<string, BidRow[]>());
}

async function advanceRoomLifecycles(client: SupabaseReadClient, roomIds: string[]) {
  await Promise.all(
    roomIds.map(async (p_room_id) => {
      const { error } = await client.rpc("advance_room_lifecycle", { p_room_id });

      if (error) {
        throw error;
      }
    }),
  );
}

async function fetchSupabaseSnapshot() {
  noStore();
  const client = createSupabaseReadClient();

  if (!client) {
    return null;
  }

  const { data: roomsData, error: roomsError } = await client
    .from("auction_rooms")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (roomsError || !roomsData?.length) {
    return null;
  }

  try {
    await advanceRoomLifecycles(
      client,
      roomsData.map((room) => room.id),
    );
  } catch {
    return null;
  }

  const { data: lotsData, error: lotsError } = await client
    .from("lots")
    .select("*")
    .in("status", visibleLotStatuses)
    .order("queue_position", { ascending: true })
    .order("next_eligible_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (lotsError || !lotsData?.length) {
    return null;
  }

  const roomById = new Map(roomsData.map((room) => [room.id, room]));
  const visibleLots = lotsData.filter((lot) => roomById.has(lot.room_id));
  const lotIds = visibleLots.map((lot) => lot.id);
  const [imagesByLotId, bidsByLotId] = await Promise.all([
    fetchLotImages(client, lotIds),
    fetchBids(client, lotIds),
  ]);
  const uiLots = visibleLots.map((lot, index) =>
    mapSupabaseLot(
      {
        lot,
        room: roomById.get(lot.room_id),
        images: imagesByLotId.get(lot.id) ?? [],
        bids: bidsByLotId.get(lot.id) ?? [],
      },
      index + 1,
    ),
  );
  const uiLotById = new Map(uiLots.map((lot) => [lot.id, lot]));
  const liveLotByRoomId = new Map<string, Lot>();

  visibleLots.forEach((lot) => {
    if (!currentLotStatuses.includes(lot.status) || liveLotByRoomId.has(lot.room_id)) {
      return;
    }

    const uiLot = uiLotById.get(lot.id);

    if (uiLot) {
      liveLotByRoomId.set(lot.room_id, uiLot);
    }
  });

  visibleLots.forEach((lot) => {
    if (liveLotByRoomId.has(lot.room_id)) {
      return;
    }

    const uiLot = uiLotById.get(lot.id);

    if (uiLot) {
      liveLotByRoomId.set(lot.room_id, uiLot);
    }
  });

  const rooms = roomsData.map((room) => mapSupabaseRoom(room, liveLotByRoomId.get(room.id)));
  const bidRows = Array.from(bidsByLotId.values()).flat();
  const sourceLotsById = new Map(visibleLots.map((lot) => [lot.id, lot]));

  return {
    rooms,
    lots: uiLots,
    bidRows,
    sourceLotsById,
  };
}

function getRoomFromSnapshot(snapshot: SupabaseSnapshot, roomSlug: string) {
  return snapshot.rooms.find((room) => room.slug === roomSlug || room.id === roomSlug) ?? null;
}

function getLotsForRoom(snapshot: SupabaseSnapshot, roomSlug: string) {
  return snapshot.lots.filter((lot) => lot.roomId === roomSlug);
}

export async function getAuctionRooms() {
  noStore();
  const snapshot = await fetchSupabaseSnapshot();
  return snapshot?.rooms.length ? snapshot.rooms : getMockAuctionRooms();
}

export async function getLiveLotByRoomSlug(roomSlug: string) {
  noStore();
  const snapshot = await fetchSupabaseSnapshot();

  if (!snapshot) {
    const mockRoom = getMockRoomBySlug(roomSlug);
    return mockRoom ? getMockLiveLotForRoom(mockRoom.id) : mockLiveLot;
  }

  const room = getRoomFromSnapshot(snapshot, roomSlug);

  if (!room) {
    return null;
  }

  return (
    snapshot.lots.find((lot) => lot.id === room.liveLotId) ??
    getLotsForRoom(snapshot, room.slug)[0] ??
    null
  );
}

export async function getUpcomingLotsByRoomSlug(roomSlug: string) {
  noStore();
  const snapshot = await fetchSupabaseSnapshot();

  if (!snapshot) {
    const mockRoom = getMockRoomBySlug(roomSlug);
    const currentLot = mockRoom ? getMockLiveLotForRoom(mockRoom.id) : mockLiveLot;
    const roomLots = mockRoom
      ? getMockRoomLots(mockRoom.id).filter((lot) => lot.id !== currentLot.id)
      : [];

    return [...roomLots, ...mockUpcomingLots].slice(0, 5);
  }

  const room = getRoomFromSnapshot(snapshot, roomSlug);

  if (!room) {
    return [];
  }

  return getLotsForRoom(snapshot, room.slug)
    .filter((lot) => lot.id !== room.liveLotId)
    .filter((lot) => {
      const sourceLot = snapshot.sourceLotsById.get(lot.id);
      return sourceLot ? upcomingLotStatuses.includes(sourceLot.status) : true;
    })
    .slice(0, 6);
}

export async function getLotById(lotId: string) {
  noStore();
  const snapshot = await fetchSupabaseSnapshot();

  if (!snapshot) {
    return getMockLotById(lotId) ?? null;
  }

  return snapshot.lots.find((lot) => lot.id === lotId) ?? null;
}

export async function getBidsByLotId(lotId: string) {
  noStore();
  const client = createSupabaseReadClient();

  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("bids")
    .select("*")
    .eq("lot_id", lotId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data;
}

export async function listLots() {
  noStore();
  const snapshot = await fetchSupabaseSnapshot();
  return snapshot?.lots.length ? snapshot.lots : mockLots;
}

export function getStaticRoomParams() {
  return mockAuctionRooms.map((room) => ({ roomId: room.id }));
}

export function getStaticLotParams() {
  return mockLots.map((lot) => ({ lotId: lot.id }));
}

export async function getHomeAuctionData() {
  noStore();
  const rooms = await getAuctionRooms();
  const activeRoom = rooms[0] ?? getMockHomeAuctionData().activeRoom;
  const currentLot =
    (await getLiveLotByRoomSlug(activeRoom.slug ?? activeRoom.id)) ?? getMockHomeAuctionData().currentLot;
  const upcomingLots = await getUpcomingLotsByRoomSlug(activeRoom.slug ?? activeRoom.id);

  return {
    rooms,
    activeRoom,
    currentLot,
    upcomingLots: upcomingLots.length ? upcomingLots : getMockHomeAuctionData().upcomingLots,
  };
}

export async function getRoomAuctionData(roomSlug: string) {
  noStore();
  const rooms = await getAuctionRooms();
  const activeRoom =
    rooms.find((room) => room.slug === roomSlug || room.id === roomSlug) ?? null;

  if (!activeRoom) {
    return null;
  }

  const currentLot = await getLiveLotByRoomSlug(activeRoom.slug ?? activeRoom.id);

  if (!currentLot) {
    return null;
  }

  const upcomingLots = await getUpcomingLotsByRoomSlug(activeRoom.slug ?? activeRoom.id);

  return {
    rooms,
    activeRoom,
    currentLot,
    upcomingLots,
  };
}

export async function getLotAuctionData(lotId: string) {
  noStore();
  const currentLot = await getLotById(lotId);

  if (!currentLot) {
    return null;
  }

  const rooms = await getAuctionRooms();
  const activeRoom =
    rooms.find((room) => room.slug === currentLot.roomId || room.id === currentLot.roomId) ??
    rooms[0] ??
    null;

  if (!activeRoom) {
    return null;
  }

  const upcomingLots = (await getUpcomingLotsByRoomSlug(activeRoom.slug ?? activeRoom.id)).filter(
    (lot) => lot.id !== currentLot.id,
  );

  return {
    rooms,
    activeRoom,
    currentLot,
    upcomingLots,
  };
}
