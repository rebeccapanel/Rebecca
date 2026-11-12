import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"

/**
 * jsdom implements neither `matchMedia` nor the observer APIs. The theme
 * provider reads `matchMedia` on mount, and radix/floating-ui components use
 * the observers to measure themselves.
 *
 * The stubs are re-installed before every test (rather than once at module
 * load) so a test that calls `vi.unstubAllGlobals()` cannot break the next one.
 */
function installBrowserStubs() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }))
  )

  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )

  vi.stubGlobal(
    "IntersectionObserver",
    class IntersectionObserverStub {
      readonly root: Element | Document | null = null
      readonly rootMargin = "0px"
      readonly thresholds: ReadonlyArray<number> = [0]
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
  )
}

beforeEach(() => {
  installBrowserStubs()
})

afterEach(() => {
  // Unmount React trees and forget call history so tests stay independent.
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
