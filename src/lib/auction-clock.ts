export function getDeadlineSeconds(deadline: string | null | undefined, nowMs: number) {
  const target = deadline ? Date.parse(deadline) : NaN;
  return Number.isFinite(target) ? Math.max(0, Math.ceil((target - nowMs) / 1000)) : 0;
}

export function getClockOffsetMs(serverTime: string, requestStarted: number, responseReceived: number) {
  const timestamp = Date.parse(serverTime);
  return Number.isFinite(timestamp) ? timestamp - (requestStarted + responseReceived) / 2 : 0;
}

export function parseBidAmount(value: string) {
  const trimmed = value.trim();
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(trimmed)) return NaN;
  const amount = Number(trimmed.replaceAll(",", ""));
  return amount > 0 && amount <= 999999999999.99 ? amount : NaN;
}
