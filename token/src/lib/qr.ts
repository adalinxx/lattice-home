import QRCode from "qrcode";
import type { OrderIntent } from "./intent.ts";

function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function walletIntentURI(intent: OrderIntent): string {
  return `lattice://order?v=1&intent=${base64url(JSON.stringify(intent))}`;
}

export function walletIntentQR(intent: OrderIntent): Promise<string> {
  return QRCode.toDataURL(walletIntentURI(intent), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
}
