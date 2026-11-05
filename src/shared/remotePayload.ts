import { REMOTE_FRAME_BYTES } from "./remote";

const MAX_NODES = 32_768;

/** Conservative JSON byte budget, without serializing or scanning string contents.
 * null rejects the value before worker-port cloning. Protocol values are plain
 * JSON data, but can contain huge images or deeply nested extension output.
 */
export function remotePayloadBytes(message: unknown): number | null {
  const pending: unknown[] = [message];
  let nodes = 1;
  let remaining = REMOTE_FRAME_BYTES;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") remaining -= value.length * 6 + 2;
    else if (value === null || value === undefined || typeof value === "boolean") remaining -= 5;
    else if (typeof value === "number") remaining -= 24;
    else if (Array.isArray(value)) {
      if ((nodes += value.length) > MAX_NODES) return null;
      remaining -= value.length + 2;
      for (const item of value) pending.push(item);
    } else if (typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      remaining -= 2;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (++nodes > MAX_NODES) return null;
        remaining -= key.length * 6 + 4;
        if (remaining < 0) return null;
        pending.push((value as Record<string, unknown>)[key]);
      }
    } else return null;
    if (remaining < 0) return null;
  }
  return REMOTE_FRAME_BYTES - remaining;
}

export function remotePayloadFits(message: unknown): boolean {
  return remotePayloadBytes(message) !== null;
}
