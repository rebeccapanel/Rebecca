import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { UsersPage } from "@/features/users/users-page"
import {
  createFetchMock,
  jsonResponse,
  renderWithProviders,
  type FetchHandler,
  type FetchMock,
} from "@/test/utils"
import type { UserListItem, UsersResponse } from "@/types/api"

const GB = 1024 ** 3

/** Byte values are wrapped in Unicode isolates so RTL text cannot reorder them. */
const stripIsolates = (value: string) => value.replace(/[\u2066-\u2069]/g, "")

function makeUser(
  overrides: Partial<UserListItem> & Pick<UserListItem, "id" | "username">
): UserListItem {
  return {
    status: "active",
    used_traffic: 0,
    lifetime_used_traffic: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    // `null` means "never expires", which keeps the expiry column independent of
    // the wall clock.
    expire: null,
    data_limit: null,
    online_at: null,
    is_online: false,
    service_id: 1,
    service_name: "north-gateway",
    admin_id: 1,
    admin_username: "owner",
    links: [],
    subscription_url: "https://panel.example.com/sub/example",
    subscription_urls: {},
    ...overrides,
  }
}

const USERS: UserListItem[] = [
  makeUser({
    id: 1042,
    username: "sara.ahmadi",
    status: "active",
    used_traffic: 12.5 * GB,
    data_limit: 30 * GB,
    is_online: true,
  }),
  makeUser({
    id: 1041,
    username: "mehdi.karimi",
    status: "expired",
    used_traffic: 800 * 1024 ** 2,
    data_limit: 10 * GB,
  }),
  makeUser({
    id: 1040,
    username: "niloofar.rafiei",
    status: "disabled",
  }),
]

/** 137 accounts on the panel, this page shows the first three. */
const USERS_RESPONSE: UsersResponse = {
  users: USERS,
  link_templates: {},
  total: 137,
  users_limit: 200,
  status_breakdown: {
    active: 96,
    expired: 14,
    limited: 7,
    on_hold: 5,
    disabled: 15,
  },
  usage_total: 2.5 * GB,
  online_total: 23,
}

describe("UsersPage", () => {
  let activeMock: FetchMock | undefined

  function mockFetch(handler: FetchHandler): FetchMock {
    activeMock = createFetchMock(handler)
    activeMock.install()
    return activeMock
  }

  afterEach(() => {
    activeMock?.restore()
    activeMock = undefined
  })

  /** The value element rendered immediately after a summary label. */
  function valueAfter(label: string): Element {
    const labelNode = screen.getByText(label)
    const value = labelNode.nextElementSibling
    if (!value) throw new Error(`No value element after "${label}"`)
    return value
  }

  it("replaces the loading skeletons with the summary metrics and user rows", async () => {
    let resolveResponse: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })

    const requested: URL[] = []
    mockFetch((request) => {
      // The screen probes the session first; treat the operator as signed out so
      // the admin/service filters stay disabled and only /api/users is fetched.
      if (request.url.pathname !== "/api/users") {
        return jsonResponse({ detail: "Could not validate credentials" }, 401)
      }
      requested.push(request.url)
      return pending
    })

    const { container } = renderWithProviders(<UsersPage />, {
      route: "/users",
    })

    // Loading: the page is all skeletons and the table has no rows yet.
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText("sara.ahmadi")).not.toBeInTheDocument()

    await act(async () => {
      resolveResponse(jsonResponse(USERS_RESPONSE))
    })

    // Rows: one per user, with the username rendered in the first column.
    expect(await screen.findByText("sara.ahmadi")).toBeInTheDocument()
    expect(screen.getByText("mehdi.karimi")).toBeInTheDocument()
    expect(screen.getByText("niloofar.rafiei")).toBeInTheDocument()

    // Summary band: total (with plan limit), online count and traffic.
    expect(valueAfter("Total users")).toHaveTextContent("137")
    expect(valueAfter("Total users")).toHaveTextContent("/ 200")
    // The band now shows the online count as its own label + value pair.
    expect(screen.getByText("Online now")).toBeInTheDocument()
    // Byte values are wrapped in Unicode isolates so RTL text cannot reorder them.
    expect(
      screen
        .getAllByText(
          (_, element) =>
            element?.children.length === 0 && stripIsolates(element?.textContent ?? "") === "2.5 GB",
        )
        .length,
    ).toBeGreaterThan(0)

    // The skeletons are gone once data has arrived.
    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
        0
      )
    })

    // The list request is server-paged from the first page.
    expect(requested).toHaveLength(1)
    expect(requested[0].pathname).toBe("/api/users")
    expect(requested[0].searchParams.get("offset")).toBe("0")
    expect(requested[0].searchParams.get("limit")).toBe("20")
  })

  it("shows the retry affordance after an error and refetches when clicked", async () => {
    let attempts = 0
    let userRequests = 0
    mockFetch((request) => {
      if (request.url.pathname !== "/api/users") {
        return jsonResponse({ detail: "Could not validate credentials" }, 401)
      }
      attempts += 1
      userRequests += 1
      return attempts === 1
        ? jsonResponse({ detail: "panel exploded" }, 500)
        : jsonResponse(USERS_RESPONSE)
    })

    renderWithProviders(<UsersPage />, { route: "/users" })

    // Error state comes from DataTable, not from a raw error string.
    expect(await screen.findByText("Could not load users")).toBeInTheDocument()
    expect(userRequests).toBe(1)

    const user = userEvent.setup({ delay: null })
    await user.click(screen.getByRole("button", { name: "Retry" }))

    // Retrying issues a second request and the recovered data replaces the error.
    expect(await screen.findByText("sara.ahmadi")).toBeInTheDocument()
    await waitFor(() => expect(userRequests).toBe(2))
  })
})
