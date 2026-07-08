// Generates an ephemeral ECDSA P-256 key pair, exports the private key as a PKCS#8 PEM
// (the same format Apple ships in `.p8` files), and exposes the public key for verification.
//
// Used by JWT-signing tests so we never need a real .p8 in the repo.

export interface KeyFixture {
  privateKeyPem: string;
  publicKey: CryptoKey;
}

function toPem(label: string, der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export async function makeKeyFixture(): Promise<KeyFixture> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    privateKeyPem: toPem("PRIVATE KEY", pkcs8),
    publicKey: pair.publicKey,
  };
}
