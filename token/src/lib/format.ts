import { RATE_SCALE } from "./intent.ts";

/** An amount in whole units, grouped for reading. The explorer and the wallet
 * show the same digits. */
export function formatUnits(value: bigint | string): string {
  return BigInt(value).toLocaleString("en-US");
}

/** A RATE_SCALE fixed-point exchange rate as a plain decimal. */
export function formatRate(rate: bigint): string {
  const fraction = (rate % RATE_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${rate / RATE_SCALE}.${fraction}` : (rate / RATE_SCALE).toString();
}

export function shorten(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text for an innerHTML template (element content or a quoted attribute). */
export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}
