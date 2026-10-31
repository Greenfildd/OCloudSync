const MAGIC = new Uint8Array([0x4d, 0x43, 0x53, 0x31]); // MCS1
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 310_000;
const PATH_PREFIX = "~mcs1~";
const OPENSSL_MAGIC = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // Salted__
const OPENSSL_PATH_PREFIX = "~ossl~";
const OPENSSL_ITERATIONS = 20_000;
let pathKeys: { password: string; enc: CryptoKey; mac: CryptoKey } | undefined;

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable in this Obsidian environment.");
  return globalThis.crypto;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptFile(data: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const crypto = webCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const output = new Uint8Array(MAGIC.length + salt.length + iv.length + encrypted.length);
  output.set(MAGIC, 0);
  output.set(salt, MAGIC.length);
  output.set(iv, MAGIC.length + salt.length);
  output.set(encrypted, MAGIC.length + salt.length + iv.length);
  return output.buffer;
}

async function encryptOpenSsl(data: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const crypto = webCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: OPENSSL_ITERATIONS },
    material,
    384
  ));
  const keyBytes = derived.slice(0, 32);
  const iv = derived.slice(32, 48);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, data));
  const output = new Uint8Array(OPENSSL_MAGIC.length + salt.length + encrypted.length);
  output.set(OPENSSL_MAGIC, 0);
  output.set(salt, OPENSSL_MAGIC.length);
  output.set(encrypted, OPENSSL_MAGIC.length + salt.length);
  return output.buffer;
}

async function decryptOpenSsl(data: Uint8Array, password: string): Promise<ArrayBuffer> {
  const headerLength = OPENSSL_MAGIC.length + 8;
  if (data.length < headerLength + 16 || !OPENSSL_MAGIC.every((byte, index) => data[index] === byte)) {
    throw new Error("Could not decrypt OpenSSL-format data. The encrypted file may be damaged.");
  }
  const salt = data.slice(OPENSSL_MAGIC.length, headerLength);
  const material = await webCrypto().subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const derived = new Uint8Array(await webCrypto().subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: OPENSSL_ITERATIONS },
    material,
    384
  ));
  const key = await webCrypto().subtle.importKey("raw", derived.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
  try {
    return await webCrypto().subtle.decrypt({ name: "AES-CBC", iv: derived.slice(32, 48) }, key, data.slice(headerLength));
  } catch {
    throw new Error("OpenSSL-compatible decryption failed. Check the password or whether the file is damaged.");
  }
}

export async function encryptFileWithMethod(data: ArrayBuffer, password: string, method: "aes-gcm" | "openssl-aes-cbc"): Promise<ArrayBuffer> {
  return method === "openssl-aes-cbc" ? encryptOpenSsl(data, password) : encryptFile(data, password);
}

export async function decryptFile(data: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const input = new Uint8Array(data);
  if (OPENSSL_MAGIC.every((byte, index) => input[index] === byte)) return decryptOpenSsl(input, password);
  const headerLength = MAGIC.length + SALT_LENGTH + IV_LENGTH;
  // Existing remote files may predate encryption being enabled. Let them sync
  // as plaintext; all subsequent uploads are still encrypted by writeRemote.
  // A recognized header with invalid/truncated ciphertext remains an error.
  if (!MAGIC.every((byte, index) => input[index] === byte)) return data;
  if (input.length < headerLength + 16) {
    throw new Error("Could not decrypt remote file. The encrypted file may be damaged.");
  }
  const salt = input.slice(MAGIC.length, MAGIC.length + SALT_LENGTH);
  const iv = input.slice(MAGIC.length + SALT_LENGTH, headerLength);
  const key = await deriveKey(password, salt);
  try {
    return await webCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, input.slice(headerLength));
  } catch {
    throw new Error("Could not decrypt remote file. The encryption password may be incorrect or the file may be damaged.");
  }
}

async function getPathKeys(password: string): Promise<{ enc: CryptoKey; mac: CryptoKey }> {
  if (pathKeys?.password === password) return pathKeys;
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("My Cloud Sync path names v1"), iterations: ITERATIONS,
  }, material, 512);
  const bytes = new Uint8Array(bits);
  const enc = await crypto.subtle.importKey("raw", bytes.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const mac = await crypto.subtle.importKey("raw", bytes.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  pathKeys = { password, enc, mac };
  return pathKeys;
}

async function pathIv(name: string, mac: CryptoKey): Promise<Uint8Array> {
  const digest = new Uint8Array(await webCrypto().subtle.sign("HMAC", mac, new TextEncoder().encode(name)));
  return digest.slice(0, 12);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encryptPath(path: string, password: string, method: "aes-gcm" | "openssl-aes-cbc" = "aes-gcm"): Promise<string> {
  if (method === "openssl-aes-cbc") {
    return (await Promise.all(path.split("/").map(async (part) => {
      if (!part) return part;
      const plain = new TextEncoder().encode(part);
      const encrypted = await encryptOpenSsl(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer, password);
      return `${OPENSSL_PATH_PREFIX}${toBase64Url(new Uint8Array(encrypted))}`;
    }))).join("/");
  }
  const parts = path.split("/");
  const { enc, mac } = await getPathKeys(password);
  return (await Promise.all(parts.map(async (part) => {
    if (!part) return part;
    const iv = await pathIv(part, mac);
    const encoded = new TextEncoder().encode(part);
    const cipher = new Uint8Array(await webCrypto().subtle.encrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer }, enc,
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
    ));
    const output = new Uint8Array(iv.length + cipher.length);
    output.set(iv);
    output.set(cipher, iv.length);
    return `${PATH_PREFIX}${toBase64Url(output)}`;
  }))).join("/");
}

export async function decryptPath(path: string, password: string): Promise<string> {
  const parts = path.split("/");
  const { enc, mac } = await getPathKeys(password);
  return (await Promise.all(parts.map(async (part) => {
    if (part.startsWith(OPENSSL_PATH_PREFIX)) {
      try {
        const input = fromBase64Url(part.slice(OPENSSL_PATH_PREFIX.length));
        const plain = await decryptOpenSsl(input, password);
        return new TextDecoder("utf-8", { fatal: true }).decode(plain);
      } catch {
        throw new Error("Could not decrypt OpenSSL-format file or folder names. Check that the encryption password matches.");
      }
    }
    if (!part || !part.startsWith(PATH_PREFIX)) return part;
    try {
      const input = fromBase64Url(part.slice(PATH_PREFIX.length));
      const iv = input.slice(0, 12);
      const plain = await webCrypto().subtle.decrypt({ name: "AES-GCM", iv }, enc, input.slice(12));
      const name = new TextDecoder("utf-8", { fatal: true }).decode(plain);
      const expectedIv = await pathIv(name, mac);
      if (!expectedIv.every((byte, i) => byte === iv[i])) throw new Error("Invalid encrypted path");
      return name;
    } catch {
      throw new Error("Could not decrypt remote file or folder names. Check that the same encryption password is set on every device.");
    }
  }))).join("/");
}
