// Presentation order only: preserve database order for all other rooms.
export function orderSidebarRooms<T extends { id: string; slug?: string }>(rooms: T[]): T[] {
 const isHall = (room: T) => (room.slug ?? room.id) === "general-room";
 return [...rooms.filter(isHall), ...rooms.filter(room => !isHall(room))];
}
