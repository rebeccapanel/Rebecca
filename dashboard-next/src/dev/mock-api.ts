/**
 * Development-only API mock, enabled with `VITE_MOCK_API=1`.
 *
 * The panel it talks to lives behind credentials, so design work needs a
 * deterministic dataset. This shim intercepts `fetch` for `/api/*` and answers
 * from fixtures; it never ships in a production build because the flag is read
 * from the environment at startup.
 */
import type {
  Admin,
  AdminsResponse,
  Node,
  Service,
  ServicesResponse,
  SystemStats,
  UserListItem,
  UsersResponse,
} from "@/types/api"

const ENABLED = import.meta.env.VITE_MOCK_API === "1"

const USERNAMES = [
  "sara.ahmadi", "mehdi.karimi", "reza.mousavi", "niloofar.rafiei", "amir.hosseini",
  "zahra.ebrahimi", "kian.sadeghi", "parisa.nouri", "arman.jafari", "shirin.tabatabai",
  "davood.rahimi", "elnaz.shahbazi", "farid.ghasemi", "hasti.moradi", "ilya.zahedi",
  "mahtab.soltan", "navid.bahrami", "omid.nejati", "pantea.azizi", "qasem.rostami",
  "roya.hemmati", "saeed.ansari", "taraneh.veisi", "vahid.ashrafi", "yasmin.farhadi",
]

const STATUSES: UserListItem["status"][] = ["active", "active", "active", "active", "limited", "expired", "disabled", "on_hold"]

const DAY = 86_400
const GB = 1024 ** 3
const NOW = Math.floor(Date.now() / 1000)

function buildUsers(count: number): UserListItem[] {
  return Array.from({ length: count }).map((_, index) => {
    const status = STATUSES[index % STATUSES.length]
    const username = `${USERNAMES[index % USERNAMES.length]}${index >= USERNAMES.length ? index : ""}`
    const dataLimit = index % 7 === 0 ? null : [30, 50, 100, 200][index % 4] * GB
    const used = dataLimit ? Math.round(dataLimit * (status === "limited" ? 1 : (0.1 + ((index * 37) % 80) / 100))) : Math.round((index % 9) * 4.3 * GB)
    const online = index % 6 === 2
    return {
      id: 1042 - index,
      username,
      status,
      used_traffic: used,
      lifetime_used_traffic: used * 3,
      created_at: new Date((NOW - index * 3 * DAY) * 1000).toISOString(),
      expire: index % 5 === 0 ? null : NOW + (index % 9 === 0 ? -4 : 12 + index) * DAY,
      data_limit: dataLimit,
      data_limit_reset_strategy: index % 3 === 0 ? "month" : "no_reset",
      online_at: online ? new Date((NOW - 30) * 1000).toISOString() : null,
      is_online: online,
      service_id: (index % 2) + 1,
      service_name: index % 2 === 0 ? "north-gateway" : "edge-eu",
      admin_id: (index % 3) + 1,
      admin_username: ["owner", "reseller.one", "reseller.two"][index % 3],
      links: [],
      subscription_url: `https://panel.example.com/sub/${username}`,
      subscription_urls: {},
    }
  })
}

const USERS = buildUsers(137)

const ADMINS: Admin[] = [
  {
    id: 1, username: "owner", role: "full_access", status: "active", services: [1, 2],
    users_usage: 412 * GB, lifetime_usage: 1_240 * GB, created_traffic: 0, deleted_users_usage: 12 * GB,
    data_limit: null, traffic_limit_mode: "used_traffic", show_user_traffic: true, expire: null,
    users_limit: null, require_2fa: true, totp_enabled: true,
    users_count: 92, active_users: 61, online_users: 14, limited_users: 8, expired_users: 9,
    on_hold_users: 3, disabled_users: 11,
  },
  {
    id: 2, username: "reseller.one", role: "reseller", status: "active", services: [1],
    users_usage: 188 * GB, lifetime_usage: 640 * GB, created_traffic: 0, deleted_users_usage: 0,
    data_limit: 750 * GB, traffic_limit_mode: "used_traffic", show_user_traffic: true, expire: NOW + 28 * DAY,
    users_limit: 60, require_2fa: false, totp_enabled: false,
    users_count: 34, active_users: 22, online_users: 5, limited_users: 3, expired_users: 4,
    on_hold_users: 1, disabled_users: 4,
  },
  {
    id: 3, username: "reseller.two", role: "reseller", status: "disabled", services: [2],
    users_usage: 96 * GB, lifetime_usage: 210 * GB, created_traffic: 0, deleted_users_usage: 0,
    data_limit: 120 * GB, traffic_limit_mode: "used_traffic", show_user_traffic: false, expire: NOW - 3 * DAY,
    users_limit: 25, require_2fa: false, totp_enabled: false,
    users_count: 11, active_users: 3, online_users: 0, limited_users: 2, expired_users: 5,
    on_hold_users: 1, disabled_users: 0,
  },
]

const NODES: Node[] = [
  {
    id: 1, name: "edge-eu-1", note: "Hetzner FSN1", address: "eu1.node.internal", port: 62050, api_port: 62051,
    usage_coefficient: 1, status: "connected", agent_status: "connected", xray_status: "running",
    message: null, xray_version: "25.9.11", node_version: "1.8.0", node_service_version: "1.8.0",
    node_install_mode: "binary", cpu_cores: 8, cpu_usage_percent: 24.6, memory_used: 3.1 * GB,
    memory_total: 16 * GB, memory_usage_percent: 19.4, uptime_seconds: 1_284_000,
    upload_speed: 3.4 * 1024 ** 2, download_speed: 9.8 * 1024 ** 2, uplink: 2.1 * 1024 ** 4, downlink: 6.7 * 1024 ** 4,
    protocol_statuses: [
      { protocol: "vless", state: "running", inbounds: 4, version: "25.9.11" },
      { protocol: "trojan", state: "running", inbounds: 2, version: "25.9.11" },
    ],
    capabilities: ["xray", "certificates"],
  },
  {
    id: 2, name: "edge-asia-1", note: "Singapore", address: "sg1.node.internal", port: 62050, api_port: 62051,
    usage_coefficient: 1.5, status: "connecting", agent_status: "connecting", xray_status: "starting",
    message: "waiting for core handshake", xray_version: "25.9.11", node_version: "1.8.0", node_service_version: "1.7.9",
    node_install_mode: "docker", cpu_cores: 4, cpu_usage_percent: 71.2, memory_used: 5.8 * GB,
    memory_total: 8 * GB, memory_usage_percent: 72.5, uptime_seconds: 43_200,
    upload_speed: 512 * 1024, download_speed: 2.4 * 1024 ** 2, uplink: 640 * GB, downlink: 1.9 * 1024 ** 3,
    protocol_statuses: [{ protocol: "vless", state: "starting", inbounds: 2 }],
    capabilities: ["xray"],
  },
]

const HOSTS: Record<string, Array<Record<string, unknown>>> = {
  "vless-tcp": [
    { id: 1, remark: "EU · direct", address: "eu1.node.internal", port: 443, sni: "cdn.example.com", host: "cdn.example.com", path: null, security: "tls", is_disabled: false },
    { id: 2, remark: "EU · fallback", address: "eu1.node.internal", port: 8443, sni: null, host: null, path: null, security: "none", is_disabled: true },
  ],
  "trojan-ws": [
    { id: 3, remark: "ASIA · ws", address: "sg1.node.internal", port: 2096, sni: "sg1.node.internal", host: "sg1.node.internal", path: "/ws", security: "tls", is_disabled: false },
  ],
}

const SERVICES: Service[] = [
  {
    id: 1, name: "north-gateway", description: "Primary EU ingress for retail customers",
    usage_coefficient: 1, used_traffic: 412 * GB, lifetime_used_traffic: 2.4 * 1024 ** 4,
    host_count: 3, user_count: 92, has_hosts: true, broken: false,
  },
  {
    id: 2, name: "edge-eu", description: null, usage_coefficient: 1.2, used_traffic: 188 * GB,
    lifetime_used_traffic: 890 * GB, host_count: 0, user_count: 34, has_hosts: false, broken: true,
  },
]

function history(length: number, base: number, spread: number) {
  return Array.from({ length }).map((_, index) => ({
    timestamp: NOW - (length - index) * 30,
    value: Math.max(1, Math.min(100, base + Math.sin(index / 2.4) * spread + (index % 5) * 1.4)),
  }))
}

const SYSTEM: SystemStats = {
  version: "1.8.0",
  channel: "stable",
  os: "Debian 12",
  cpu_cores: 8,
  cpu_threads: 16,
  cpu_frequency_hz: 3_200_000_000,
  cpu_usage: 31.4,
  total_user: USERS.length,
  online_users: 23,
  users_active: 96,
  users_on_hold: 5,
  users_disabled: 15,
  users_expired: 14,
  users_limited: 7,
  incoming_bandwidth: 2.1 * 1024 ** 4,
  outgoing_bandwidth: 6.4 * 1024 ** 4,
  panel_total_bandwidth: 8.5 * 1024 ** 4,
  incoming_bandwidth_speed: 9.2 * 1024 ** 2,
  outgoing_bandwidth_speed: 3.8 * 1024 ** 2,
  memory: { current: 5.1 * GB, total: 16 * GB, percent: 31.9 },
  swap: { current: 0, total: 2 * GB, percent: 0 },
  disk: { current: 42 * GB, total: 240 * GB, percent: 17.5 },
  load_avg: [1.2, 1.4, 1.1],
  uptime_seconds: 1_284_000,
  panel_uptime_seconds: 1_284_000,
  xray_uptime_seconds: 1_180_000,
  xray_running: true,
  xray_version: "25.9.11",
  panel_cpu_percent: 3.4,
  panel_memory_percent: 2.1,
  cpu_history: history(40, 32, 14),
  memory_history: history(40, 32, 6),
  network_history: Array.from({ length: 40 }).map((_, index) => ({
    timestamp: NOW - (40 - index) * 30,
    incoming: (6 + Math.sin(index / 3) * 3) * 1024 ** 2,
    outgoing: (2 + Math.cos(index / 4) * 1.5) * 1024 ** 2,
  })),
  personal_usage: { total_users: 137, consumed_bytes: 412 * GB, built_bytes: 640 * GB, reset_bytes: 22 * GB, traffic_basis: "used_traffic" },
  admin_overview: {
    total_admins: ADMINS.length,
    sudo_admins: 1,
    full_access_admins: 1,
    standard_admins: 0,
    top_admin_username: "owner",
    top_admin_usage: 412 * GB,
  },
  last_xray_error: null,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sortUsers(users: UserListItem[], sort: string | null): UserListItem[] {
  if (!sort) return users
  const desc = sort.startsWith("-")
  const field = (desc ? sort.slice(1) : sort) as keyof UserListItem
  return [...users].sort((a, b) => {
    const left = a[field]
    const right = b[field]
    if (typeof left === "number" && typeof right === "number") return desc ? right - left : left - right
    return desc
      ? String(right).localeCompare(String(left))
      : String(left).localeCompare(String(right))
  })
}

function usersResponse(url: URL): UsersResponse {
  const offset = Number(url.searchParams.get("offset") ?? 0)
  const limit = Number(url.searchParams.get("limit") ?? 20)
  const search = (url.searchParams.get("search") ?? "").toLowerCase()
  const status = url.searchParams.get("status") ?? ""

  let filtered = USERS
  if (search) filtered = filtered.filter((user) => user.username.toLowerCase().includes(search))
  if (status) filtered = filtered.filter((user) => user.status === status)

  const sorted = sortUsers(filtered, url.searchParams.get("sort"))
  const page = sorted.slice(offset, offset + limit)
  const breakdown = filtered.reduce<Record<string, number>>((acc, user) => {
    acc[user.status] = (acc[user.status] ?? 0) + 1
    return acc
  }, {})

  return {
    users: page,
    link_templates: {},
    total: filtered.length,
    active_total: breakdown.active ?? 0,
    status_breakdown: breakdown,
    usage_total: filtered.reduce((sum, user) => sum + user.used_traffic, 0),
    online_total: filtered.filter((user) => user.is_online).length,
  }
}

async function handle(url: URL, init?: RequestInit): Promise<Response | null> {
  const path = url.pathname
  const method = (init?.method ?? "GET").toUpperCase()

  if (path === "/api/auth/session" || path === "/api/auth/login") {
    if (window.location.search.includes("anon=1")) {
      return json({ detail: "Could not validate credentials" }, 401)
    }
    if (method === "POST" && path === "/api/auth/login") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.password === "wrong") return json({ detail: "Incorrect username or password" }, 401)
    }
    return json({
      state: "active",
      admin: ADMINS[0],
      permissions_version: "mock",
      totp_enabled: true,
      require_2fa: false,
    })
  }
  if (path === "/api/auth/logout") return new Response(null, { status: 204 })

  if (path === "/api/users") return json(usersResponse(url))
  if (path.startsWith("/api/user/") && method === "GET") {
    const username = decodeURIComponent(path.replace("/api/user/", ""))
    const base = USERS.find((user) => user.username === username) ?? USERS[0]
    return json({
      ...base,
      note: "Imported from the reseller migration.",
      telegram_id: null,
      contact_number: null,
      ip_limit: 2,
      speed_limit_kbps: 0,
      on_hold_expire_duration: null,
      on_hold_timeout: null,
      auto_delete_in_days: null,
      flow: null,
      excluded_inbounds: {},
      inbounds: {},
      next_plans: [],
      proxies: {},
      link_data: [],
    })
  }
  if (path === "/api/system") return json(SYSTEM)
  if (path === "/api/admins") {
    const username = (url.searchParams.get("username") ?? "").toLowerCase()
    const role = url.searchParams.get("role") ?? ""
    const status = url.searchParams.get("status") ?? ""
    let admins = ADMINS
    if (username) admins = admins.filter((admin) => admin.username.toLowerCase().includes(username))
    if (role) admins = admins.filter((admin) => admin.role === role)
    if (status) admins = admins.filter((admin) => admin.status === status)
    const body: AdminsResponse = { admins, total: admins.length }
    return json(body)
  }
  if (path === "/api/nodes") return json(NODES)
  if (path === "/api/hosts") return json(HOSTS)
  if (path === "/api/v2/services") {
    const name = (url.searchParams.get("name") ?? "").toLowerCase()
    let services = SERVICES
    if (name) services = services.filter((service) => service.name.toLowerCase().includes(name))
    const body: ServicesResponse = { services, total: services.length }
    return json(body)
  }

  // Any other mutating endpoint succeeds with an empty body.
  if (method !== "GET") return new Response(null, { status: 200 })
  return null
}

export function installMockApi() {
  if (!ENABLED || typeof window === "undefined") return
  const original = window.fetch.bind(window)
  console.info("%c[mock api] fixtures active — no requests leave the browser", "color:#2dd4bf")

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, window.location.origin)
    if (!url.pathname.startsWith("/api/")) return original(input, init)

    await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 180))
    const response = await handle(url, init)
    return response ?? original(input, init)
  }
}
