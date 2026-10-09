import { ATOMIC_UNITS_PER_LAT } from "./intent.ts";

export function formatLAT(value: string): string {
  const units = BigInt(value);
  const whole = units / ATOMIC_UNITS_PER_LAT;
  const fraction = (units % ATOMIC_UNITS_PER_LAT).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
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
