import type { LotStatus } from "@/lib/supabase/types";

export type AuctionRoom = {
  id: string;
  name: string;
  strapline: string;
  category: string;
  imageUrl: string;
  liveLotId: string;
  currentBid: number;
  bidCount: number;
};

export type Lot = {
  id: string;
  lotNumber: number;
  roomId: string;
  title: string;
  category: string;
  maker: string;
  details: string[];
  description: string;
  conditionReport: string;
  shippingInfo: string;
  imageUrl: string;
  thumbnailUrl: string;
  galleryImageUrls?: string[];
  estimateLow: number;
  estimateHigh: number;
  startingBid: number;
  currentBid: number;
  bidCount: number;
  watchers: number;
  countdownSeconds: number;
  minimumIncrement: number;
  startsIn: string;
  auctionStatus: LotStatus;
  endsAt?: string | null;
  nextEligibleAt?: string | null;
};

type LotDefinition = {
  title: string;
  estimateLow: number;
  estimateHigh: number;
  startingBid: number;
};

type RoomDefinition = {
  id: string;
  name: string;
  strapline: string;
  category: string;
  imageUrl: string;
  lots: [LotDefinition, LotDefinition, LotDefinition, LotDefinition, LotDefinition];
};

const image = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=85`;
const lot = (
  title: string,
  estimateLow: number,
  estimateHigh: number,
  startingBid: number,
): LotDefinition => ({ title, estimateLow, estimateHigh, startingBid });

const roomDefinitions: RoomDefinition[] = [
  {
    id: "jewellery-room",
    name: "The Jewellery Room",
    strapline: "Live auctions. Exceptional pieces.",
    category: "Fine Jewellery",
    imageUrl: image("photo-1605100804763-247f67b3557e"),
    lots: [
      lot("Pear Shaped Diamond Pendant Necklace", 13000, 16000, 12500),
      lot("Art Deco Diamond Ring", 4000, 6000, 3600),
      lot("Sapphire and Diamond Earrings", 3000, 5000, 2500),
      lot("Emerald Cut Diamond Ring", 5000, 7000, 4750),
      lot("Diamond Tennis Bracelet", 2000, 3500, 1900),
    ],
  },
  {
    id: "watch-room",
    name: "The Watch Room",
    strapline: "Timeless craft. Precision performance.",
    category: "Watches",
    imageUrl: image("photo-1523170335258-f5ed11844a49"),
    lots: [
      lot("Vintage Chronograph Wristwatch", 7000, 9000, 6500),
      lot("Art Deco Gold Dress Watch", 2400, 3600, 2100),
      lot("Stainless Steel Diver's Wristwatch", 3200, 4800, 2800),
      lot("Victorian Silver Pocket Watch", 900, 1400, 750),
      lot("Watchmaker's Tool Cabinet", 600, 900, 450),
    ],
  },
  {
    id: "art-room",
    name: "The Art Room",
    strapline: "Iconic works. Enduring value.",
    category: "Modern Art",
    imageUrl: image("photo-1579783901586-d88db74b4fe4"),
    lots: [
      lot("Abstract Oil on Canvas", 18000, 26000, 16000),
      lot("Signed British Landscape", 1800, 2600, 1500),
      lot("Limited Edition Screen Print", 900, 1400, 750),
      lot("Modernist Bronze Sculpture", 3200, 5000, 2800),
      lot("Mid-Century Mixed Media Collage", 1200, 1800, 950),
    ],
  },
  {
    id: "collectibles-room",
    name: "The Collectibles Room",
    strapline: "Rare finds. Real stories.",
    category: "Collectibles",
    imageUrl: image("photo-1481627834876-b7833e8f5570"),
    lots: [
      lot("British Silver Coin Collection", 1200, 1800, 1000),
      lot("Vintage Model Car Archive", 700, 1100, 550),
      lot("Signed Sporting Memorabilia", 900, 1400, 750),
      lot("Victorian Postcard Album", 450, 700, 350),
      lot("Staunton Boxwood Chess Set", 600, 900, 475),
    ],
  },
  {
    id: "design-room",
    name: "The Design Room",
    strapline: "Curated design. Modern classics.",
    category: "Design",
    imageUrl: image("photo-1540574163026-643ea20ade25"),
    lots: [
      lot("Mid-Century Lounge Chair", 2500, 4200, 2200),
      lot("Studio Ceramic Table Lamp", 700, 1100, 550),
      lot("Danish Teak Sideboard", 1800, 2800, 1500),
      lot("Italian Glass Coffee Table", 1200, 1900, 950),
      lot("Architect's Swivel Desk Chair", 900, 1400, 700),
    ],
  },
  {
    id: "wine-room",
    name: "The Wine Room",
    strapline: "Fine wines. Memorable moments.",
    category: "Wine",
    imageUrl: image("photo-1510812431401-41d2bd2722f3"),
    lots: [
      lot("Twelve-Bottle Bordeaux Case", 1800, 2400, 1600),
      lot("Burgundy Grand Cru Magnum", 1200, 1700, 1000),
      lot("Vintage Champagne Collection", 900, 1300, 750),
      lot("Six-Bottle Vintage Port Lot", 650, 950, 500),
      lot("Single-Estate Tuscan Wine Case", 800, 1200, 650),
    ],
  },
  {
    id: "general-room",
    name: "The General Room",
    strapline: "Distinctive finds for every collection.",
    category: "General",
    imageUrl: image("photo-1553062407-98eeb64c6a62"),
    lots: [
      lot("Vintage Leather Travel Case", 350, 550, 275),
      lot("Decorative Brass Table Lamp", 180, 280, 140),
      lot("Framed Countryside Print", 120, 200, 90),
      lot("Handmade Ceramic Vase", 150, 240, 110),
      lot("Oak Storage Chest", 400, 650, 325),
    ],
  },
  {
    id: "antiques-room",
    name: "The Antiques Room",
    strapline: "Period craftsmanship. Lasting character.",
    category: "Antiques",
    imageUrl: image("photo-1586023492125-27b2c045efd7"),
    lots: [
      lot("Victorian Mahogany Writing Desk", 1400, 2200, 1200),
      lot("Edwardian Mantel Clock", 500, 800, 400),
      lot("Georgian Silver Candlesticks", 1100, 1700, 900),
      lot("Antique Porcelain Tea Set", 450, 700, 350),
      lot("Regency Occasional Table", 800, 1200, 650),
    ],
  },
  {
    id: "library-room",
    name: "The Library Room",
    strapline: "Rare editions. Scholarly treasures.",
    category: "Books & Library",
    imageUrl: image("photo-1507842217343-583bb7270b66"),
    lots: [
      lot("First-Edition Historical Novel", 800, 1200, 650),
      lot("Leather-Bound Encyclopedia Set", 600, 900, 475),
      lot("Victorian Writing Slope", 450, 700, 350),
      lot("Antique Terrestrial Globe", 900, 1400, 750),
      lot("Walnut Bookcase", 1200, 1800, 1000),
    ],
  },
  {
    id: "dining-room",
    name: "The Dining Room",
    strapline: "Elegant service. Memorable tables.",
    category: "Dining",
    imageUrl: image("photo-1617806118233-18e1de247200"),
    lots: [
      lot("Silver-Plated Cutlery Service", 700, 1100, 550),
      lot("Crystal Decanter Set", 350, 550, 275),
      lot("Set of Mahogany Dining Chairs", 1200, 1900, 1000),
      lot("Porcelain Dinner Service", 500, 800, 400),
      lot("Antique Serving Trolley", 650, 950, 500),
    ],
  },
  {
    id: "music-room",
    name: "The Music Room",
    strapline: "Instruments and sound with provenance.",
    category: "Music",
    imageUrl: image("photo-1511379938547-c1f69419868d"),
    lots: [
      lot("Vintage Acoustic Guitar", 900, 1400, 750),
      lot("Upright Piano Stool", 250, 400, 190),
      lot("Brass Gramophone", 600, 900, 475),
      lot("Curated Vinyl Record Collection", 500, 800, 400),
      lot("Antique Violin and Case", 1200, 1800, 1000),
    ],
  },
  {
    id: "technology-room",
    name: "The Technology Room",
    strapline: "Landmark machines. Ingenious design.",
    category: "Technology",
    imageUrl: image("photo-1518770660439-4636190af6d"),
    lots: [
      lot("Vintage Apple Computer", 1800, 2800, 1500),
      lot("Retro Games Console Bundle", 600, 900, 475),
      lot("Mechanical Keyboard Collection", 350, 550, 275),
      lot("Classic 35mm Film Camera", 700, 1100, 550),
      lot("Restored Valve Radio", 450, 700, 350),
    ],
  },
];

const testSpeedEnabled =
  process.env.NODE_ENV === "development" || process.env.AUCTION_TEST_MODE === "true";
const previewSeconds = testSpeedEnabled ? 10 : 30;
const returnedToQueueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function buildMockLot(
  room: RoomDefinition,
  roomIndex: number,
  definition: LotDefinition,
  lotIndex: number,
): Lot {
  const auctionStatus: LotStatus = lotIndex === 0 ? "PREVIEW" : lotIndex === 4 ? "UNSOLD" : "WAITING";
  const minimumIncrement = definition.startingBid >= 5000 ? 250 : definition.startingBid >= 1000 ? 100 : 50;
  const countdownSeconds = auctionStatus === "PREVIEW" ? previewSeconds : auctionStatus === "UNSOLD" ? 7 * 24 * 60 * 60 : 0;

  return {
    id: `${room.id}-lot-${lotIndex + 1}`,
    lotNumber: (roomIndex + 1) * 100 + lotIndex + 1,
    roomId: room.id,
    title: definition.title,
    category: room.category,
    maker: "Private collection",
    details: [room.category, "Curated sale", "No reserve unless stated"],
    description: `${definition.title} selected for ${room.name}, with a clear catalogue description and an estimate reflecting current specialist guidance.`,
    conditionReport: "Good auction condition with age-related wear noted in the catalogue photographs.",
    shippingInfo: "Insured UK delivery or collection by appointment. International quotes are available on request.",
    imageUrl: room.imageUrl,
    thumbnailUrl: room.imageUrl,
    galleryImageUrls: [room.imageUrl],
    estimateLow: definition.estimateLow,
    estimateHigh: definition.estimateHigh,
    startingBid: definition.startingBid,
    currentBid: definition.startingBid,
    bidCount: 0,
    watchers: 18 + roomIndex * 4 + lotIndex * 3,
    countdownSeconds,
    minimumIncrement,
    startsIn: auctionStatus === "PREVIEW" ? `00:${String(previewSeconds).padStart(2, "0")}` : auctionStatus === "UNSOLD" ? "7 days" : "Queued",
    auctionStatus,
    nextEligibleAt: auctionStatus === "UNSOLD" ? returnedToQueueAt : null,
  };
}

export const lots: Lot[] = roomDefinitions.flatMap((room, roomIndex) =>
  room.lots.map((definition, lotIndex) => buildMockLot(room, roomIndex, definition, lotIndex)),
);

export const auctionRooms: AuctionRoom[] = roomDefinitions.map((room) => {
  const liveRoomLot = lots.find((candidate) => candidate.roomId === room.id && candidate.auctionStatus === "PREVIEW");

  return {
    id: room.id,
    name: room.name,
    strapline: room.strapline,
    category: room.category,
    imageUrl: room.imageUrl,
    liveLotId: liveRoomLot?.id ?? "",
    currentBid: liveRoomLot?.currentBid ?? 0,
    bidCount: liveRoomLot?.bidCount ?? 0,
  };
});

export const liveLot = lots[0];
export const upcomingLots = lots.filter(
  (candidate) => candidate.roomId === liveLot.roomId && candidate.id !== liveLot.id,
).slice(0, 5);

export function getRoomById(roomId: string) {
  return auctionRooms.find((room) => room.id === roomId);
}

export function getLotById(lotId: string) {
  return lots.find((candidate) => candidate.id === lotId);
}

export function getLiveLotForRoom(roomId: string) {
  const room = getRoomById(roomId);
  return lots.find((candidate) => candidate.id === room?.liveLotId) ?? liveLot;
}

export function getRoomLots(roomId: string) {
  return lots.filter((candidate) => candidate.roomId === roomId);
}
