import { describe, expect, it } from "vitest"

import {
  daysLeft,
  formatBytes,
  formatDuration,
  isNever,
  usageRatio,
} from "@/lib/format"

const GB = 1024 ** 3

/** Byte/percent helpers wrap tokens in Unicode isolates for RTL safety. */
const plain = (value: string) => value.replace(/[\u2066-\u2069]/g, "")
const DAY_SECONDS = 86_400

/** The panel stores "no expiry" as MaxInt64; `2 ** 63` is its exact double value. */
const NEVER_SENTINEL = 2 ** 63

/** Fixed "now" in milliseconds so the tests never depend on the wall clock. */
const NOW = Date.UTC(2026, 0, 1)
const NOW_SECONDS = NOW / 1000

describe("formatBytes", () => {
  it("renders zero without a unit prefix", () => {
    expect(plain(formatBytes(0))).toBe("0 B")
  })

  it("keeps 1023 bytes in the byte unit and groups the digits", () => {
    expect(plain(formatBytes(1023))).toBe("1,023 B")
  })

  it("crosses into KB exactly at 1024", () => {
    expect(plain(formatBytes(1024))).toBe("1 KB")
    expect(plain(formatBytes(1024 ** 2))).toBe("1 MB")
  })

  it("formats gigabytes with the default fraction digits", () => {
    expect(plain(formatBytes(1.5 * GB))).toBe("1.5 GB")
  })

  it("falls back to the unlimited placeholder for a missing value", () => {
    expect(formatBytes(null)).toBe("—")
    expect(formatBytes(undefined)).toBe("—")
    expect(formatBytes(null, "en", { unlimited: "Unlimited" })).toBe(
      "Unlimited"
    )
  })
})

describe("isNever", () => {
  it("treats null, zero and negative timestamps as never", () => {
    expect(isNever(null)).toBe(true)
    expect(isNever(undefined)).toBe(true)
    expect(isNever(0)).toBe(true)
    expect(isNever(-1)).toBe(true)
  })

  it("treats timestamps past year 3000 as the unlimited sentinel", () => {
    expect(isNever(32_503_680_000)).toBe(false)
    expect(isNever(32_503_680_001)).toBe(true)
    expect(isNever(NEVER_SENTINEL)).toBe(true)
  })

  it("accepts ordinary unix timestamps", () => {
    expect(isNever(1_700_000_000)).toBe(false)
  })
})

describe("daysLeft", () => {
  it("returns whole days until a future expiry", () => {
    expect(daysLeft(NOW_SECONDS + 3 * DAY_SECONDS, NOW)).toBe(3)
  })

  it("returns negative days for an already expired account", () => {
    expect(daysLeft(NOW_SECONDS - 4 * DAY_SECONDS, NOW)).toBe(-4)
  })

  it("rounds partial days up, so an account only reads as expired after expiry", () => {
    expect(daysLeft(NOW_SECONDS + 1.2 * DAY_SECONDS, NOW)).toBe(2)
    // Math.ceil(-0.2) is -0, which compares equal to 0 numerically.
    expect(daysLeft(NOW_SECONDS - 0.2 * DAY_SECONDS, NOW)).toBeCloseTo(0)
  })

  it("returns null for the never sentinel", () => {
    expect(daysLeft(null, NOW)).toBeNull()
    expect(daysLeft(0, NOW)).toBeNull()
    expect(daysLeft(NEVER_SENTINEL, NOW)).toBeNull()
  })
})

describe("usageRatio", () => {
  it("returns the used-to-limit fraction", () => {
    expect(usageRatio(5, 10)).toBe(0.5)
  })

  it("clamps below zero and above one", () => {
    expect(usageRatio(-5, 10)).toBe(0)
    expect(usageRatio(25, 10)).toBe(1)
  })

  it("returns null when the plan has no usable limit", () => {
    expect(usageRatio(5, null)).toBeNull()
    expect(usageRatio(5, 0)).toBeNull()
    expect(usageRatio(5, -1)).toBeNull()
  })
})

describe("formatDuration", () => {
  it("renders a dash for zero, null and negative durations", () => {
    expect(formatDuration(0)).toBe("—")
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(-5)).toBe("—")
  })

  it("falls back to seconds below a minute", () => {
    expect(formatDuration(45)).toBe("45s")
  })

  it("renders minutes, hours and days", () => {
    expect(formatDuration(90)).toBe("1m")
    expect(formatDuration(3600)).toBe("1h")
    expect(formatDuration(86_400)).toBe("1d")
  })

  it("combines days and hours", () => {
    expect(formatDuration(90_000)).toBe("1d 1h")
  })
})
