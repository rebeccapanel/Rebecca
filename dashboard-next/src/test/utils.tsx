import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import type { ReactElement } from "react"
import { I18nextProvider } from "react-i18next"

import { TooltipProvider } from "@/components/ui/tooltip"
import { MemoryRouter } from "react-router-dom"
import { vi, type Mock } from "vitest"

import { testI18n } from "@/test/i18n"

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export type RenderWithProvidersOptions = {
  /** Initial `MemoryRouter` location, e.g. `"/users?page=2"`. */
  route?: string
}

export type RenderWithProvidersResult = RenderResult & {
  queryClient: QueryClient
}

/**
 * Renders a screen with the same providers the app mounts at the root, minus
 * the network: a fresh `QueryClient` (no retries, no cached data between
 * renders), the in-memory English i18n instance, and a router at `route`.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/" }: RenderWithProvidersOptions = {}
): RenderWithProvidersResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  const result = render(
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )

  return { ...result, queryClient }
}

/* -------------------------------------------------------------------------- */
/* fetch mocking                                                              */
/* -------------------------------------------------------------------------- */

/** The pieces of an outgoing request a handler may want to inspect. */
export type MockFetchRequest = {
  url: URL
  method: string
  headers: Headers
  body: string | null
  signal: AbortSignal | null
}

/**
 * Returns the response for a request, or `undefined` to let the next handler
 * try. Returning a promise lets a test hold the request open (useful for
 * asserting loading states).
 */
export type FetchHandler = (
  request: MockFetchRequest
) => Response | Promise<Response> | undefined

export type FetchMock = {
  /** The stub itself, for `expect(fetchMock).toHaveBeenCalledTimes(…)`. */
  fetchMock: Mock<typeof fetch>
  install: () => void
  restore: () => void
}

const realFetch = globalThis.fetch

/**
 * Builds a typed `fetch` stub from one or more handlers. Intended for the
 * beforeEach/afterEach pairing:
 *
 * ```ts
 * let mock: FetchMock | undefined
 * beforeEach(() => { mock = createFetchMock(handler); mock.install() })
 * afterEach(() => { mock?.restore() })
 * ```
 *
 * Requests no handler answers throw, so a test fails loudly instead of leaking
 * a real network call.
 */
export function createFetchMock(
  handlers: FetchHandler | FetchHandler[]
): FetchMock {
  const queue = Array.isArray(handlers) ? handlers : [handlers]

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const request: MockFetchRequest = {
      url: new URL(raw, "http://localhost"),
      method: (init?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers),
      body:
        typeof init?.body === "string"
          ? init.body
          : init?.body == null
            ? null
            : String(init.body),
      signal: init?.signal ?? null,
    }

    for (const handler of queue) {
      const response = await handler(request)
      if (response) return response
    }

    throw new Error(
      `Unhandled fetch: ${request.method} ${request.url.pathname}${request.url.search}`
    )
  })

  return {
    fetchMock,
    install: () => vi.stubGlobal("fetch", fetchMock),
    restore: () => vi.stubGlobal("fetch", realFetch),
  }
}

/** Typed JSON response helper for `fetch` handlers. */
export function jsonResponse(body: unknown, status = 200): Response {
  const headers = { "Content-Type": "application/json" }
  if (status === 204 || body === undefined) {
    return new Response(null, { status, headers })
  }
  return new Response(JSON.stringify(body), { status, headers })
}
