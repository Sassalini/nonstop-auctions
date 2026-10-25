// Plain text only: React escapes the output. Do not render seller-supplied HTML.
export function descriptionParagraphs(description: string, condition: string): string[] {
 const main = description.trim();
 const normalize = (value: string) => value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").toLocaleLowerCase("en-GB");
 const seen = [normalize(main)];
 const extra = condition.split(/\r?\n+/).map(text => text.trim()).filter(text => {
  if (!text || /^(condition report pending\.?|no condition report\.?)$/i.test(text)) return false;
  const normalized = normalize(text);
  if (!normalized || seen.some(existing => existing.includes(normalized))) return false;
  seen.push(normalized); return true;
 });
 return [main, ...extra];
}
