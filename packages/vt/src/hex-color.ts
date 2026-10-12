const hexPattern = /^[0-9a-fA-F]+$/;

export function normalizeHexColor(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return;
  const raw = String(value).trim();
  if (!raw) return;
  let hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!hexPattern.test(hex)) return;

  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  } else if (hex.length !== 6 && hex.length !== 8) {
    return;
  }

  return `#${hex.toUpperCase()}`;
}
