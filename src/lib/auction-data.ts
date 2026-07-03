import {
  auctionRooms,
  getLiveLotForRoom,
  getLotById,
  getRoomById,
  getRoomLots,
  liveLot,
  lots,
  upcomingLots,
} from "@/lib/mock-data";

export type { AuctionRoom, Lot } from "@/lib/mock-data";

export { auctionRooms, getLiveLotForRoom, getLotById, getRoomById, getRoomLots, liveLot, lots, upcomingLots };

export async function getHomeAuctionData() {
  return {
    rooms: auctionRooms,
    activeRoom: auctionRooms[0],
    currentLot: liveLot,
    upcomingLots,
  };
}

export async function listAuctionRooms() {
  return auctionRooms;
}

export async function listLots() {
  return lots;
}

export function getStaticRoomParams() {
  return auctionRooms.map((room) => ({ roomId: room.id }));
}

export function getStaticLotParams() {
  return lots.map((lot) => ({ lotId: lot.id }));
}

export async function getRoomAuctionData(roomId: string) {
  const room = getRoomById(roomId);

  if (!room) {
    return null;
  }

  const currentLot = getLiveLotForRoom(room.id);
  const roomLots = getRoomLots(room.id).filter((lot) => lot.id !== currentLot.id);
  const sidebarLots = [...roomLots, ...upcomingLots].slice(0, 5);

  return {
    rooms: auctionRooms,
    activeRoom: room,
    currentLot,
    upcomingLots: sidebarLots,
  };
}

export async function getLotAuctionData(lotId: string) {
  const lot = getLotById(lotId);

  if (!lot) {
    return null;
  }

  const room = getRoomById(lot.roomId);

  if (!room) {
    return null;
  }

  const relatedLots = lots
    .filter((relatedLot) => relatedLot.roomId === room.id && relatedLot.id !== lot.id)
    .concat(upcomingLots)
    .filter((relatedLot, index, allLots) => {
      return allLots.findIndex((candidate) => candidate.id === relatedLot.id) === index;
    })
    .slice(0, 5);

  return {
    rooms: auctionRooms,
    activeRoom: room,
    currentLot: lot,
    upcomingLots: relatedLots,
  };
}
