export function parseLotReference(value: unknown): number | null {
 if (typeof value !== "string") return null;
 const match = /^(?:lot\s*#?\s*|#\s*)?(\d+)$/i.exec(value.trim());
 if (!match) return null;
 const number = Number(match[1]);
 return Number.isSafeInteger(number) && number > 0 ? number : null;
}
