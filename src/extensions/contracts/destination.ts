/** Exact, non-wildcard destination identifiers used by grants and resolved requests. */
export type DestinationPolicy = "none" | "approved-public-https" | "host-selected-connection" | "fixed-origins";
export const EXTENSION_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const isHostConnection = (value: string): boolean => /^connection:[A-Za-z0-9._:-]{1,120}$/u.test(value);

export function isPublicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash && url.hostname.includes(".")
      && !url.hostname.endsWith(".local") && url.hostname !== "localhost"
      && !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(url.hostname) && !url.hostname.includes(":");
  } catch { return false; }
}

export function isPolicyDestination(mode: DestinationPolicy, value: string, fixed: readonly string[] = []): boolean {
  if (mode === "none") return false;
  if (mode === "host-selected-connection") return isHostConnection(value);
  if (mode === "fixed-origins") return fixed.includes(value) && isPublicHttpsOrigin(value);
  return isPublicHttpsOrigin(value);
}
