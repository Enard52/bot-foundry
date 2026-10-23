/** JSON with sorted object keys, so equal values always produce the same string. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        const entry = (v as Record<string, unknown>)[k];
        if (entry !== undefined) sorted[k] = entry;
      }
      return sorted;
    }
    return v;
  });
}

/** cyrb53: a fast, well-mixed 53-bit string hash (public domain, by bryc). Combined with the length for the cache key. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${n.toString(16)}.${s.length.toString(16)}`;
}

export const stableHash = (value: unknown): string => hashString(canonical(value));
