// Passcode-based encryption with WebCrypto: PBKDF2-SHA256 derives an AES-GCM-256 key.
// Used for the locked localStorage data and for password-protected backup files.

export const ITERATIONS = 600_000;

export interface Sealed {
  sealed: 1;
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 AES-GCM ciphertext of the JSON value
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(secret: string, salt: string, iterations = ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealWith(key: CryptoKey, salt: string, iterations: number, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { sealed: 1, kdf: "pbkdf2-sha256", iterations, salt, iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

// Throws when the key is wrong (AES-GCM authentication fails) or the data was tampered with.
export async function openWith(key: CryptoKey, sealed: Sealed): Promise<unknown> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, key, fromB64(sealed.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function seal(password: string, value: unknown): Promise<Sealed> {
  const salt = newSalt();
  return sealWith(await deriveKey(password, salt), salt, ITERATIONS, value);
}

export async function open(password: string, sealed: Sealed): Promise<unknown> {
  return openWith(await deriveKey(password, sealed.salt, sealed.iterations), sealed);
}

export function isSealed(v: unknown): v is Sealed {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.sealed === 1 &&
    typeof o.iterations === "number" &&
    typeof o.salt === "string" &&
    typeof o.iv === "string" &&
    typeof o.data === "string"
  );
}
