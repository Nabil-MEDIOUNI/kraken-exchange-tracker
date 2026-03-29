import crypto from "crypto";

const BASE_URL = "https://futures.kraken.com";

let lastNonce = 0n;

function getNonce(): string {
  const now = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  lastNonce = now > lastNonce ? now : lastNonce + 1n;
  return lastNonce.toString();
}

function signRequest(privateKey: string, endpoint: string, postData: string, nonce: string): string {
  const path = endpoint.startsWith("/derivatives") ? endpoint.slice("/derivatives".length) : endpoint;
  const message = postData + nonce + path;
  const hash = crypto.createHash("sha256").update(message, "utf8").digest();
  const secretBuf = Buffer.from(privateKey, "base64");
  return crypto.createHmac("sha512", secretBuf).update(hash).digest("base64");
}

export interface FuturesClientConfig {
  publicKey: string;
  privateKey: string;
}

export function createFuturesClient({ publicKey, privateKey }: FuturesClientConfig) {
  async function request(endpoint: string, { postDataInSign = false } = {}): Promise<any> {
    const nonce = getNonce();
    let signPath = endpoint;
    let postData = "";

    if (postDataInSign && endpoint.includes("?")) {
      const [path, qs] = endpoint.split("?");
      signPath = path;
      postData = qs;
    }

    const authent = signRequest(privateKey, signPath, postData, nonce);
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: "GET",
      headers: { APIKey: publicKey, Nonce: nonce, Authent: authent },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kraken Futures API ${res.status}: ${text}`);
    }
    return res.json();
  }

  return { request };
}
