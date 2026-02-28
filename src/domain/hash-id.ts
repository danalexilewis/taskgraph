import { createHash } from "node:crypto";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
const HASH_ID_REGEX = /^tg-[0-9a-fA-F]{6,7}$/;

/** Deterministically derives a short hash id from a UUID. */
export function generateHashId(uuid: string): string {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error("Invalid UUID format");
  }
  const hash = createHash("sha256").update(uuid).digest("hex");
  const short = hash.slice(0, 6);
  return `tg-${short}`;
}

/** Returns true if the input matches the tg-XXXXXX or tg-XXXXXXX hash id format. */
export function isHashId(input: string): boolean {
  return HASH_ID_REGEX.test(input);
}

/** Returns a unique hash_id for the given task_id, avoiding collisions with usedIds.
 * On collision, appends extra hex chars from the hash until unique (up to 7 chars). */
export function generateUniqueHashId(
  uuid: string,
  usedIds: Set<string>,
): string {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error("Invalid UUID format");
  }
  const hash = createHash("sha256").update(uuid).digest("hex");
  for (let len = 6; len <= 7; len++) {
    const candidate = `tg-${hash.slice(0, len)}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not generate unique hash_id for ${uuid} (collision saturation)`,
  );
}
