const IV_SIZE = 12;
const TAG_SIZE = 16;
const HMAC_LENGTH = 48;

export const AES256HMACSHA384HEX = {
  async encrypt(aesKeyBase64, hmacKeyBase64, plaintext) {
    const aesKeyRaw = base64ToBytes(aesKeyBase64);
    const hmacKeyRaw = base64ToBytes(hmacKeyBase64);

    const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));

    const aesKey = await crypto.subtle.importKey(
      "raw",
      aesKeyRaw,
      "AES-GCM",
      false,
      ["encrypt"]
    );

    const cipherTextWithTag = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: TAG_SIZE * 8,
      },
      aesKey,
      new TextEncoder().encode(plaintext)
    );

    const encryptedMessage = new Uint8Array(iv.length + cipherTextWithTag.byteLength);
    encryptedMessage.set(iv);
    encryptedMessage.set(new Uint8Array(cipherTextWithTag), iv.length);

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      hmacKeyRaw,
      { name: "HMAC", hash: "SHA-384" },
      false,
      ["sign"]
    );

    const hmac = await crypto.subtle.sign("HMAC", hmacKey, encryptedMessage);

    const finalBuffer = new Uint8Array(hmac.byteLength + encryptedMessage.length);
    finalBuffer.set(new Uint8Array(hmac));
    finalBuffer.set(encryptedMessage, hmac.byteLength);

    return bytesToHex(finalBuffer);
  },

  async decrypt(aesKeyBase64, hmacKeyBase64, hexCipherText) {
    const aesKeyRaw = base64ToBytes(aesKeyBase64);
    const hmacKeyRaw = base64ToBytes(hmacKeyBase64);
    const fullMessage = hexToBytes(hexCipherText);

    if (fullMessage.length < HMAC_LENGTH + IV_SIZE + TAG_SIZE) {
      throw new Error("Invalid ciphertext length");
    }

    const hmacReceived = fullMessage.slice(0, HMAC_LENGTH);
    const encryptedData = fullMessage.slice(HMAC_LENGTH);

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      hmacKeyRaw,
      { name: "HMAC", hash: "SHA-384" },
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify("HMAC", hmacKey, hmacReceived, encryptedData);
    if (!isValid) {
      throw new Error("HMAC validation failed. Data may be tampered!");
    }

    const iv = encryptedData.slice(0, IV_SIZE);
    const cipherTextWithTag = encryptedData.slice(IV_SIZE);

    const aesKey = await crypto.subtle.importKey(
      "raw",
      aesKeyRaw,
      "AES-GCM",
      false,
      ["decrypt"]
    );

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: TAG_SIZE * 8,
      },
      aesKey,
      cipherTextWithTag
    );

    return new TextDecoder().decode(decrypted);
  },
};

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
