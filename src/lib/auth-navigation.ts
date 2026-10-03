export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) return "/my-auctions";
  // Decode once to reject encoded slashes/backslashes that could change the URL authority.
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u0020\u007f]/.test(decoded)) return "/my-auctions";
  } catch { return "/my-auctions"; }
  return value;
}
