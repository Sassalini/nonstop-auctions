export type LiveLotCandidate = {
  id: string;
  roomSlug: string;
  roomOrder: number;
};

// Presence keys are random anonymous browser-session tokens, never account IDs.
// Multiple channel connections/tabs under one key count once per lot.
export function countLotViewers(state: Record<string, readonly { lot_id?: unknown }[]>) {
  const counts: Record<string, number> = {};
  for (const connections of Object.values(state)) {
    const lotIds = new Set(connections.map((connection) => connection.lot_id)
      .filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)));
    for (const id of lotIds) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

// Tie/zero-viewer fallback: Grand Hall, then room display order, then lot UUID.
// Candidates contain only database current phases, including preview.
export function selectLiveLot(lots: readonly LiveLotCandidate[], counts: Record<string, number>) {
  return [...lots].sort((a, b) =>
    (counts[b.id] ?? 0) - (counts[a.id] ?? 0)
    || Number(b.roomSlug === "general-room") - Number(a.roomSlug === "general-room")
    || a.roomOrder - b.roomOrder
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0] ?? null;
}
