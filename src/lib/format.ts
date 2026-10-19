export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatEstimate(low: number, high: number) {
  return `${formatCurrency(low)} - ${formatCurrency(high)}`;
}

export function formatLotId(id: string) {
  return id.replace("lot-", "Lot ");
}
