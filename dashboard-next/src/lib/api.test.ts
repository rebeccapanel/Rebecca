import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, buildQuery, request, UNAUTHORIZED_EVENT } from "@/lib/api"
import {
  createFetchMock,
  jsonResponse,
  type FetchHandler,
  type FetchMock,
} from "@/test/utils"

describe("buildQuery", () => {
  it("returns an empty string when there is nothing to serialise", () => {
    expect(buildQuery()).toBe("")
    expect(buildQuery({})).toBe("")
  })

  it("serialises scalars in insertion order", () => {
    expect(buildQuery({ offset: 0, limit: 20 })).toBe("?offset=0&limit=20")
  })

  it("repeats the key for array values", () => {
    expect(buildQuery({ sort: ["name", "-used"] })).toBe(
      "?sort=name&sort=-used"
    )
  })

  it("drops null, undefined and empty string values", () => {
    expect(
      buildQuery({ offset: 0, search: "", status: undefined, admin: null })
    ).toBe("?offset=0")
  })

  it("drops empty entries inside arrays", () => {
    expect(buildQuery({ tag: ["a", "", "b"] })).toBe("?tag=a&tag=b")
  })

  it("percent-encodes keys and values", () => {
    expect(buildQuery({ search: "sara & co", "x y": "a=b" })).toBe(
      "?search=sara+%26+co&x+y=a%3Db"
    )
  })
})

describe("request", () => {
  let activeMock: FetchMock | undefined

  function mockFetch(handlers: FetchHandler | FetchHandler[]): FetchMock {
    activeMock = createFetchMock(handlers)
    activeMock.install()
    return activeMock
  }

  afterEach(() => {
    activeMock?.restore()
    activeMock = undefined
  })

  it("sends credentialed requests, appends the query, and parses JSON", async () => {
    const { fetchMock } = mockFetch(() => jsonResponse({ ok: true }))

    const result = await request<{ ok: boolean }>("/users", {
      params: { search: "sara" },
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/users?search=sara")
    expect(init?.credentials).toBe("include")
    expect(init?.method).toBe("GET")
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json")
  })

  it("serialises a JSON body and sets Content-Type", async () => {
    const { fetchMock } = mockFetch(() => jsonResponse({ created: true }))

    await request("/users", { method: "POST", body: { username: "sara" } })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe("POST")
    expect(init?.body).toBe(JSON.stringify({ username: "sara" }))
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json"
    )
  })

  it("returns undefined for 204 No Content", async () => {
    mockFetch(() => jsonResponse(undefined, 204))

    await expect(
      request("/auth/logout", { method: "POST" })
    ).resolves.toBeUndefined()
  })

  it("throws ApiError carrying the server's detail on non-2xx responses", async () => {
    mockFetch(() => jsonResponse({ detail: "User not found" }, 404))

    const error = await request("/users/ghost").catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: "ApiError",
      status: 404,
      detail: "User not found",
    })
  })

  it("dispatches the unauthorized event on a 401", async () => {
    // A real EventTarget listener, not a spy on dispatchEvent: this is exactly
    // how the app shell listens for an expired session.
    const listener = vi.fn<(event: Event) => void>()
    window.addEventListener(UNAUTHORIZED_EVENT, listener)
    mockFetch(() => jsonResponse({ detail: "Session expired" }, 401))

    try {
      await expect(request("/auth/session")).rejects.toBeInstanceOf(ApiError)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].type).toBe(UNAUTHORIZED_EVENT)
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener)
    }
  })
})
