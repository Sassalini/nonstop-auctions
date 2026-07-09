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

const jewelleryImage =
  "https://images.unsplash.com/photo-1608042314453-ae338d80c427?auto=format&fit=crop&w=1400&q=85";
const ringImage =
  "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=80";
const watchImage =
  "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=900&q=80";
const artImage =
  "https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=900&q=80";
const collectableImage =
  "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=900&q=80";
const chairImage =
  "https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=900&q=80";
const wineImage =
  "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=900&q=80";

const returnedToQueueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

export const auctionRooms: AuctionRoom[] = [
  {
    id: "jewellery-room",
    name: "The Jewellery Room",
    strapline: "Live auctions. Exceptional pieces.",
    category: "Fine Jewellery",
    imageUrl: ringImage,
    liveLotId: "lot-128",
    currentBid: 12500,
    bidCount: 0,
  },
  {
    id: "watch-room",
    name: "The Watch Room",
    strapline: "Timeless craft. Precision performance.",
    category: "Watches",
    imageUrl: watchImage,
    liveLotId: "lot-215",
    currentBid: 8750,
    bidCount: 17,
  },
  {
    id: "art-room",
    name: "The Art Room",
    strapline: "Iconic works. Enduring value.",
    category: "Modern Art",
    imageUrl: artImage,
    liveLotId: "lot-054",
    currentBid: 22000,
    bidCount: 14,
  },
  {
    id: "collectibles-room",
    name: "The Collectibles Room",
    strapline: "Rare finds. Real stories.",
    category: "Collectibles",
    imageUrl: collectableImage,
    liveLotId: "lot-332",
    currentBid: 1250,
    bidCount: 9,
  },
  {
    id: "design-room",
    name: "The Design Room",
    strapline: "Curated design. Modern classics.",
    category: "Design",
    imageUrl: chairImage,
    liveLotId: "lot-078",
    currentBid: 3200,
    bidCount: 11,
  },
  {
    id: "wine-room",
    name: "The Wine Room",
    strapline: "Fine wines. Memorable moments.",
    category: "Wine",
    imageUrl: wineImage,
    liveLotId: "lot-402",
    currentBid: 1100,
    bidCount: 7,
  },
];

export const lots: Lot[] = [
  {
    id: "lot-128",
    lotNumber: 128,
    roomId: "jewellery-room",
    title: "Pear Shaped Diamond Pendant Necklace",
    category: "Fine Jewellery",
    maker: "GIA certified",
    details: ["18ct White Gold", "3.52ct Pear Cut Diamond", "G Colour", "VS1 Clarity"],
    description:
      "A striking pear shaped diamond pendant necklace set in 18ct white gold. The centre diamond weighs approximately 3.52 carats and is accompanied by a GIA certificate.",
    conditionReport:
      "Excellent overall condition with light handling marks visible under magnification. Clasp is secure and stones are bright, lively, and well matched.",
    shippingInfo:
      "Insured UK delivery from GBP 35. International shipping available after checkout, subject to customs and local import rules.",
    imageUrl: jewelleryImage,
    thumbnailUrl: jewelleryImage,
    galleryImageUrls: [
      jewelleryImage,
      ringImage,
      "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80",
    ],
    estimateLow: 13000,
    estimateHigh: 16000,
    startingBid: 12500,
    currentBid: 12500,
    bidCount: 0,
    watchers: 127,
    countdownSeconds: 30,
    minimumIncrement: 250,
    startsIn: "00:30",
    auctionStatus: "PREVIEW",
  },
  {
    id: "lot-129",
    lotNumber: 129,
    roomId: "jewellery-room",
    title: "Art Deco Diamond Ring",
    category: "Fine Jewellery",
    maker: "Unsigned",
    details: ["Platinum", "Old European Cut", "Art Deco Mount", "Size M"],
    description:
      "An elegant Art Deco diamond ring with geometric shoulders and a bright central stone in a platinum mount.",
    conditionReport:
      "Good antique condition with expected wear to the shank. Stones secure and mount presents well.",
    shippingInfo:
      "Insured jewellery courier available. Collection by appointment from the London office.",
    imageUrl: ringImage,
    thumbnailUrl: ringImage,
    estimateLow: 4000,
    estimateHigh: 6000,
    startingBid: 3600,
    currentBid: 3600,
    bidCount: 0,
    watchers: 61,
    countdownSeconds: 30,
    minimumIncrement: 100,
    startsIn: "00:30",
    auctionStatus: "FIRST_BID_WINDOW",
  },
  {
    id: "lot-130",
    lotNumber: 130,
    roomId: "jewellery-room",
    title: "Sapphire and Diamond Earrings",
    category: "Fine Jewellery",
    maker: "Continental",
    details: ["18ct Gold", "Oval Sapphires", "Diamond Halo", "Post Fittings"],
    description:
      "A balanced pair of sapphire and diamond earrings with vivid blue centres and bright diamond halos.",
    conditionReport:
      "Very good condition. Minor surface wear to fittings, with stones appearing secure.",
    shippingInfo:
      "Ships in a fitted presentation box with insured delivery options at checkout.",
    imageUrl:
      "https://images.unsplash.com/photo-1619119069152-a2b331eb392a?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1619119069152-a2b331eb392a?auto=format&fit=crop&w=900&q=80",
    estimateLow: 3000,
    estimateHigh: 5000,
    startingBid: 2500,
    currentBid: 2800,
    bidCount: 6,
    watchers: 44,
    countdownSeconds: 5,
    minimumIncrement: 100,
    startsIn: "00:05",
    auctionStatus: "ACTIVE_BIDDING",
  },
  {
    id: "lot-131",
    lotNumber: 131,
    roomId: "jewellery-room",
    title: "Emerald Cut Diamond Ring",
    category: "Fine Jewellery",
    maker: "Private collection",
    details: ["Platinum", "Emerald Cut", "Tapered Baguettes", "Size N"],
    description:
      "A clean emerald cut diamond ring with tapered baguette shoulders and crisp architectural lines.",
    conditionReport:
      "Excellent condition with crisp facets and minimal wear. Requires final sizing confirmation.",
    shippingInfo:
      "High value lots ship by specialist insured courier only.",
    imageUrl:
      "https://images.unsplash.com/photo-1589674781759-c21c37956a44?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1589674781759-c21c37956a44?auto=format&fit=crop&w=900&q=80",
    estimateLow: 5000,
    estimateHigh: 7000,
    startingBid: 4750,
    currentBid: 4750,
    bidCount: 0,
    watchers: 73,
    countdownSeconds: 7 * 24 * 60 * 60,
    minimumIncrement: 150,
    startsIn: "7 days",
    auctionStatus: "UNSOLD",
    nextEligibleAt: returnedToQueueAt,
  },
  {
    id: "lot-132",
    lotNumber: 132,
    roomId: "jewellery-room",
    title: "Tennis Bracelet",
    category: "Fine Jewellery",
    maker: "Modern",
    details: ["18ct White Gold", "Round Brilliant Diamonds", "Box Clasp", "17.5cm"],
    description:
      "A classic diamond tennis bracelet with a continuous line of bright round brilliant cut stones.",
    conditionReport:
      "Good condition. Clasp closes securely and safety catch is working.",
    shippingInfo:
      "Insured delivery from GBP 35. Export paperwork can be arranged.",
    imageUrl:
      "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=80",
    estimateLow: 2000,
    estimateHigh: 3500,
    startingBid: 1900,
    currentBid: 1900,
    bidCount: 0,
    watchers: 38,
    countdownSeconds: 1080,
    minimumIncrement: 100,
    startsIn: "03:00",
    auctionStatus: "WAITING",
  },
  {
    id: "lot-215",
    lotNumber: 215,
    roomId: "watch-room",
    title: "Vintage Chronograph Wristwatch",
    category: "Watches",
    maker: "Swiss",
    details: ["Manual Wind", "Steel Case", "Two Register Dial", "Leather Strap"],
    description:
      "A sharp vintage chronograph with balanced dial architecture and a warm aged finish.",
    conditionReport:
      "Running at time of cataloguing. Service history is not documented.",
    shippingInfo:
      "Specialist watch shipping available, with optional collection from our London desk.",
    imageUrl: watchImage,
    thumbnailUrl: watchImage,
    estimateLow: 7000,
    estimateHigh: 9000,
    startingBid: 8000,
    currentBid: 8750,
    bidCount: 17,
    watchers: 93,
    countdownSeconds: 5,
    minimumIncrement: 250,
    startsIn: "00:05",
    auctionStatus: "ACTIVE_BIDDING",
  },
  {
    id: "lot-054",
    lotNumber: 54,
    roomId: "art-room",
    title: "Abstract Oil on Canvas",
    category: "Modern Art",
    maker: "British school",
    details: ["Oil on Canvas", "Signed Lower Right", "Framed", "92 x 122cm"],
    description:
      "A large scale abstract composition with layered colour, movement, and strong room presence.",
    conditionReport:
      "Minor surface marks to frame. Canvas appears stable with no obvious tears.",
    shippingInfo:
      "Fine art courier quote required before dispatch.",
    imageUrl: artImage,
    thumbnailUrl: artImage,
    estimateLow: 18000,
    estimateHigh: 26000,
    startingBid: 20000,
    currentBid: 22000,
    bidCount: 14,
    watchers: 86,
    countdownSeconds: 5,
    minimumIncrement: 500,
    startsIn: "00:05",
    auctionStatus: "ACTIVE_BIDDING",
  },
  {
    id: "lot-078",
    lotNumber: 78,
    roomId: "design-room",
    title: "Mid-Century Lounge Chair",
    category: "Design",
    maker: "Attributed Danish",
    details: ["Leather", "Walnut Frame", "1960s", "Restored"],
    description:
      "A handsome mid-century lounge chair with a sculptural walnut frame and deep leather seat.",
    conditionReport:
      "Restored condition with attractive patina to the leather and light frame wear.",
    shippingInfo:
      "Furniture courier quote available after the auction.",
    imageUrl: chairImage,
    thumbnailUrl: chairImage,
    estimateLow: 2500,
    estimateHigh: 4200,
    startingBid: 3000,
    currentBid: 3200,
    bidCount: 11,
    watchers: 52,
    countdownSeconds: 5,
    minimumIncrement: 100,
    startsIn: "00:05",
    auctionStatus: "ACTIVE_BIDDING",
  },
];

export const liveLot = lots[0];

export const upcomingLots = lots.slice(1, 6);

export function getRoomById(roomId: string) {
  return auctionRooms.find((room) => room.id === roomId);
}

export function getLotById(lotId: string) {
  return lots.find((lot) => lot.id === lotId);
}

export function getLiveLotForRoom(roomId: string) {
  const room = getRoomById(roomId);
  return lots.find((lot) => lot.id === room?.liveLotId) ?? liveLot;
}

export function getRoomLots(roomId: string) {
  return lots.filter((lot) => lot.roomId === roomId);
}
