/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/naming-convention */

/**
 * A direct TypeScript translation of the Wireguard key utilities used in the legacy dashboard.
 * This keeps compatibility with the existing backend expectations for WARP registration.
 */
export class Wireguard {
  static gf(init?: number[]) {
    const r = new Float64Array(16);
    if (init) {
      for (let i = 0; i < init.length; ++i) {
        r[i] = init[i];
      }
    }
    return r;
  }

  static pack(o: Uint8Array, n: Float64Array) {
    let b;
    const m = this.gf();
    const t = this.gf();
    for (let i = 0; i < 16; ++i) {
      t[i] = n[i];
    }
    this.carry(t);
    this.carry(t);
    this.carry(t);
    for (let j = 0; j < 2; ++j) {
      m[0] = t[0] - 0xffed;
      for (let i = 1; i < 15; ++i) {
        m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
        m[i - 1] &= 0xffff;
      }
      m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
      b = (m[15] >> 16) & 1;
      m[14] &= 0xffff;
      this.cswap(t, m, 1 - b);
    }
    for (let i = 0; i < 16; ++i) {
      o[2 * i] = t[i] & 0xff;
      o[2 * i + 1] = t[i] >> 8;
    }
  }

  static carry(o: Float64Array) {
    for (let i = 0; i < 16; ++i) {
      o[(i + 1) % 16] += (i < 15 ? 1 : 38) * Math.floor(o[i] / 65536);
      o[i] &= 0xffff;
    }
  }

  static cswap(p: Float64Array, q: Float64Array, b: number) {
    const c = ~(b - 1);
    for (let i = 0; i < 16; ++i) {
      const t = c & (p[i] ^ q[i]);
      p[i] ^= t;
      q[i] ^= t;
    }
  }

  static add(o: Float64Array, a: Float64Array, b: Float64Array) {
    for (let i = 0; i < 16; ++i) {
      o[i] = (a[i] + b[i]) | 0;
    }
  }

  static subtract(o: Float64Array, a: Float64Array, b: Float64Array) {
    for (let i = 0; i < 16; ++i) {
      o[i] = (a[i] - b[i]) | 0;
    }
  }

  static multmod(o: Float64Array, a: Float64Array, b: Float64Array) {
    const t = new Float64Array(31);
    for (let i = 0; i < 16; ++i) {
      for (let j = 0; j < 16; ++j) {
        t[i + j] += a[i] * b[j];
      }
    }
    for (let i = 0; i < 15; ++i) {
      t[i] += 38 * t[i + 16];
    }
    for (let i = 0; i < 16; ++i) {
      o[i] = t[i];
    }
    this.carry(o);
    this.carry(o);
  }

  static invert(o: Float64Array, i: Float64Array) {
    const c = this.gf();
    for (let a = 0; a < 16; ++a) {
      c[a] = i[a];
    }
    for (let a = 253; a >= 0; --a) {
      this.multmod(c, c, c);
      if (a !== 2 && a !== 4) {
        this.multmod(c, c, i);
      }
    }
    for (let a = 0; a < 16; ++a) {
      o[a] = c[a];
    }
  }

  static clamp(z: Uint8Array) {
    z[31] = (z[31] & 127) | 64;
    z[0] &= 248;
  }

  static generatePublicKey(privateKey: Uint8Array) {
    let r;
    const z = new Uint8Array(32);
    const a = this.gf([1]);
    const b = this.gf([9]);
    const c = this.gf();
    const d = this.gf([1]);
    const e = this.gf();
    const f = this.gf();
    const _121665 = this.gf([0xdb41, 1]);
    const _9 = this.gf([9]);
    for (let i = 0; i < 32; ++i) {
      z[i] = privateKey[i];
    }
    this.clamp(z);
    for (let i = 254; i >= 0; --i) {
      r = (z[i >>> 3] >>> (i & 7)) & 1;
      this.cswap(a, b, r);
      this.cswap(c, d, r);
      this.add(e, a, c);
      this.subtract(a, a, c);
      this.add(c, b, d);
      this.subtract(b, b, d);
      this.multmod(d, e, e);
      this.multmod(f, a, a);
      this.multmod(a, c, a);
      this.multmod(c, b, e);
      this.add(e, a, c);
      this.subtract(a, a, c);
      this.multmod(b, a, a);
      this.subtract(c, d, f);
      this.multmod(a, c, _121665);
      this.add(a, a, d);
      this.multmod(c, c, a);
      this.multmod(a, d, f);
      this.multmod(d, b, _9);
      this.multmod(b, e, e);
      this.cswap(a, b, r);
      this.cswap(c, d, r);
    }
    this.invert(c, c);
    this.multmod(a, a, c);
    this.pack(z, a);
    return z;
  }

  static generatePresharedKey() {
    const privateKey = new Uint8Array(32);
    const cryptoObj: Crypto | undefined = (globalThis as any)?.crypto;
    if (!cryptoObj?.getRandomValues) {
      throw new Error("Crypto.getRandomValues is not available in this environment.");
    }
    cryptoObj.getRandomValues(privateKey);
    return privateKey;
  }

  static generatePrivateKey() {
    const privateKey = this.generatePresharedKey();
    this.clamp(privateKey);
    return privateKey;
  }

  static encodeBase64(dest: Uint8Array, src: Uint8Array) {
    const input = Uint8Array.from([
      (src[0] >> 2) & 63,
      ((src[0] << 4) | (src[1] >> 4)) & 63,
      ((src[1] << 2) | (src[2] >> 6)) & 63,
      src[2] & 63,
    ]);
    for (let i = 0; i < 4; ++i) {
      dest[i] =
        input[i] +
        65 +
        (((25 - input[i]) >> 8) & 6) -
        (((51 - input[i]) >> 8) & 75) -
        (((61 - input[i]) >> 8) & 15) +
        (((62 - input[i]) >> 8) & 3);
    }
  }

  static keyToBase64(key: Uint8Array) {
    let i;
    const base64 = new Uint8Array(44);
    for (i = 0; i < 32 / 3; ++i) {
      this.encodeBase64(base64.subarray(i * 4), key.subarray(i * 3));
    }
    this.encodeBase64(
      base64.subarray(i * 4),
      Uint8Array.from([key[i * 3 + 0], key[i * 3 + 1], 0])
    );
    base64[43] = 61;
    return Array.from(base64)
      .map((byte) => String.fromCharCode(byte))
      .join("");
  }

  static keyFromBase64(encoded: string) {
    const binaryStr = globalThis.atob(encoded);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  static generateKeypair(secretKey = "") {
    const privateKey =
      secretKey.length > 0 ? this.keyFromBase64(secretKey) : this.generatePrivateKey();
    const publicKey = this.generatePublicKey(privateKey);
    return {
      publicKey: this.keyToBase64(publicKey),
      privateKey: secretKey.length > 0 ? secretKey : this.keyToBase64(privateKey),
    };
  }
}

export const generateWireguardKeypair = (secretKey?: string) =>
  Wireguard.generateKeypair(secretKey ?? "");

export const ensureWireguardGlobal = () => {
  const globalRef = globalThis as any;
  if (!globalRef.Wireguard) {
    globalRef.Wireguard = {
      generateKeypair: Wireguard.generateKeypair.bind(Wireguard),
    };
  }
};
