import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const recordEvent = internalMutation({
  args: { object: v.string(), payload: v.any() },
  returns: v.id("webhookEvents"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("webhookEvents", { object: args.object, payload: args.payload });
  },
});

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validates Meta's `X-Hub-Signature-256: sha256=<hex>` header over the raw body. */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
  return constantTimeEqual(expected, header.slice("sha256=".length).toLowerCase());
}
