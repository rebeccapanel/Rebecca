
// @ts-nocheck
const normalizeBase64 = (value: string): string =>
  value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");

const base64Decode = (value: string): string => {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    if (typeof atob === "function") {
      return atob(normalizeBase64(value));
    }
  } catch {
    // Ignore decoding errors; caller will handle invalid inputs.
  }
  return "";
};

const base64Encode = (value: string): string => {
  if (typeof value !== "string") return "";
  try {
    if (typeof btoa === "function") {
      return btoa(value);
    }
  } catch {
    // Ignore encoding errors.
  }
  return "";
};

const tryGetWireguardPublicKey = (secretKey: string): string => {
  if (typeof secretKey !== "string" || secretKey.length === 0) return "";
  const globalWireguard = (globalThis as unknown as {
    Wireguard?: { generateKeypair?: (key: string) => { publicKey?: string } };
  }).Wireguard;
  if (globalWireguard?.generateKeypair) {
    try {
      const result = globalWireguard.generateKeypair(secretKey);
      if (result && typeof result.publicKey === "string") {
        return result.publicKey;
      }
    } catch {
      // Swallow errors; returning empty string keeps UI responsive.
    }
  }
  return "";
};

class ObjectUtil {
  static isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value as object).length === 0;
    return false;
  }

  static isArrEmpty(value: unknown): boolean {
    return !Array.isArray(value) || value.length === 0;
  }
}

export const Protocols = Object.freeze({
  Freedom: "freedom",
  Blackhole: "blackhole",
  DNS: "dns",
  VMess: "vmess",
  VLESS: "vless",
  Trojan: "trojan",
  Shadowsocks: "shadowsocks",
  Socks: "socks",
  HTTP: "http",
  Wireguard: "wireguard",
} as const);

export const SSMethods = Object.freeze({
  AES_256_GCM: "aes-256-gcm",
  AES_128_GCM: "aes-128-gcm",
  CHACHA20_POLY1305: "chacha20-poly1305",
  CHACHA20_IETF_POLY1305: "chacha20-ietf-poly1305",
  XCHACHA20_POLY1305: "xchacha20-poly1305",
  XCHACHA20_IETF_POLY1305: "xchacha20-ietf-poly1305",
  BLAKE3_AES_128_GCM: "2022-blake3-aes-128-gcm",
  BLAKE3_AES_256_GCM: "2022-blake3-aes-256-gcm",
  BLAKE3_CHACHA20_POLY1305: "2022-blake3-chacha20-poly1305",
} as const);

export const TLS_FLOW_CONTROL = Object.freeze({
  VISION: "xtls-rprx-vision",
  VISION_UDP443: "xtls-rprx-vision-udp443",
} as const);

export const UTLS_FINGERPRINT = Object.freeze({
  UTLS_CHROME: "chrome",
  UTLS_FIREFOX: "firefox",
  UTLS_SAFARI: "safari",
  UTLS_IOS: "ios",
  UTLS_android: "android",
  UTLS_EDGE: "edge",
  UTLS_360: "360",
  UTLS_QQ: "qq",
  UTLS_RANDOM: "random",
  UTLS_RANDOMIZED: "randomized",
  UTLS_RONDOMIZEDNOALPN: "randomizednoalpn",
  UTLS_UNSAFE: "unsafe",
} as const);

export const ALPN_OPTION = Object.freeze({
  H3: "h3",
  H2: "h2",
  HTTP1: "http/1.1",
} as const);

export const OutboundDomainStrategies = Object.freeze([
  "AsIs",
  "UseIP",
  "UseIPv4",
  "UseIPv6",
  "UseIPv6v4",
  "UseIPv4v6",
  "ForceIP",
  "ForceIPv6v4",
  "ForceIPv6",
  "ForceIPv4v6",
  "ForceIPv4",
] as const);

export const WireguardDomainStrategy = Object.freeze([
  "ForceIP",
  "ForceIPv4",
  "ForceIPv4v6",
  "ForceIPv6",
  "ForceIPv6v4",
] as const);

export const USERS_SECURITY = Object.freeze({
  AES_128_GCM: "aes-128-gcm",
  CHACHA20_POLY1305: "chacha20-poly1305",
  AUTO: "auto",
  NONE: "none",
  ZERO: "zero",
} as const);

export const MODE_OPTION = Object.freeze({
  AUTO: "auto",
  PACKET_UP: "packet-up",
  STREAM_UP: "stream-up",
  STREAM_ONE: "stream-one",
} as const);

export const Address_Port_Strategy = Object.freeze({
  NONE: "none",
  SrvPortOnly: "srvportonly",
  SrvAddressOnly: "srvaddressonly",
  SrvPortAndAddress: "srvportandaddress",
  TxtPortOnly: "txtportonly",
  TxtAddressOnly: "txtaddressonly",
  TxtPortAndAddress: "txtportandaddress",
} as const);

export type JsonObject = Record<string, unknown>;

export class CommonClass {
  static toJsonArray<T extends CommonClass>(arr: T[]): JsonObject[] {
    return arr.map((obj) => obj.toJson());
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static fromJson(_json?: JsonObject | null): CommonClass {
    return new CommonClass();
  }

  toJson(): JsonObject {
    return {};
  }

  toString(format = true): string {
    const json = this.toJson();
    return format ? JSON.stringify(json, null, 2) : JSON.stringify(json);
  }
}

export class TcpStreamSettings extends CommonClass {
  type: string;
  host: string;
  path: string;

  constructor(type = "none", host = "", path = "") {
    super();
    this.type = type;
    this.host = host;
    this.path = path;
  }

  static override fromJson(json: any = {}): TcpStreamSettings {
    const header = json?.header;
    if (!header) return new TcpStreamSettings();
    if (header.type === "http" && header.request) {
      const host =
        header.request?.headers?.Host && Array.isArray(header.request.headers.Host)
          ? header.request.headers.Host.join(",")
          : header.request?.headers?.Host ?? "";
      const path =
        header.request?.path && Array.isArray(header.request.path)
          ? header.request.path.join(",")
          : header.request?.path ?? "";
      return new TcpStreamSettings(header.type ?? "http", host, path);
    }
    return new TcpStreamSettings(header.type ?? "none", "", "");
  }

  override toJson(): JsonObject {
    return {
      header: {
        type: this.type,
        request:
          this.type === "http"
            ? {
                headers: {
                  Host: ObjectUtil.isEmpty(this.host) ? [] : this.host.split(","),
                },
                path: ObjectUtil.isEmpty(this.path) ? ["/"] : this.path.split(","),
              }
            : undefined,
      },
    };
  }
}

export class KcpStreamSettings extends CommonClass {
  mtu: number;
  tti: number;
  upCap: number;
  downCap: number;
  congestion: boolean;
  readBuffer: number;
  writeBuffer: number;
  type: string;
  seed: string;

  constructor(
    mtu = 1350,
    tti = 50,
    uplinkCapacity = 5,
    downlinkCapacity = 20,
    congestion = false,
    readBufferSize = 2,
    writeBufferSize = 2,
    type = "none",
    seed = ""
  ) {
    super();
    this.mtu = mtu ?? 1350;
    this.tti = tti ?? 50;
    this.upCap = uplinkCapacity ?? 5;
    this.downCap = downlinkCapacity ?? 20;
    this.congestion = Boolean(congestion);
    this.readBuffer = readBufferSize ?? 2;
    this.writeBuffer = writeBufferSize ?? 2;
    this.type = type ?? "none";
    this.seed = seed ?? "";
  }

  static override fromJson(json: any = {}): KcpStreamSettings {
    return new KcpStreamSettings(
      json?.mtu,
      json?.tti,
      json?.uplinkCapacity,
      json?.downlinkCapacity,
      json?.congestion,
      json?.readBufferSize,
      json?.writeBufferSize,
      json?.header?.type ?? "none",
      json?.seed ?? ""
    );
  }

  override toJson(): JsonObject {
    return {
      mtu: this.mtu,
      tti: this.tti,
      uplinkCapacity: this.upCap,
      downlinkCapacity: this.downCap,
      congestion: this.congestion,
      readBufferSize: this.readBuffer,
      writeBufferSize: this.writeBuffer,
      header: {
        type: this.type,
      },
      seed: this.seed,
    };
  }
}

export class WsStreamSettings extends CommonClass {
  path: string;
  host: string;
  heartbeatPeriod: number;

  constructor(path = "/", host = "", heartbeatPeriod = 0) {
    super();
    this.path = path ?? "/";
    this.host = host ?? "";
    this.heartbeatPeriod = heartbeatPeriod ?? 0;
  }

  static override fromJson(json: any = {}): WsStreamSettings {
    return new WsStreamSettings(json?.path ?? "/", json?.host ?? "", json?.heartbeatPeriod ?? 0);
  }

  override toJson(): JsonObject {
    return {
      path: this.path,
      host: this.host,
      heartbeatPeriod: this.heartbeatPeriod,
    };
  }
}

export class GrpcStreamSettings extends CommonClass {
  serviceName: string;
  authority: string;
  multiMode: boolean;

  constructor(serviceName = "", authority = "", multiMode = false) {
    super();
    this.serviceName = serviceName ?? "";
    this.authority = authority ?? "";
    this.multiMode = Boolean(multiMode);
  }

  static override fromJson(json: any = {}): GrpcStreamSettings {
    return new GrpcStreamSettings(json?.serviceName ?? "", json?.authority ?? "", Boolean(json?.multiMode));
  }

  override toJson(): JsonObject {
    return {
      serviceName: this.serviceName,
      authority: this.authority,
      multiMode: this.multiMode,
    };
  }
}

export class HttpUpgradeStreamSettings extends CommonClass {
  path: string;
  host: string;

  constructor(path = "/", host = "") {
    super();
    this.path = path ?? "/";
    this.host = host ?? "";
  }

  static override fromJson(json: any = {}): HttpUpgradeStreamSettings {
    return new HttpUpgradeStreamSettings(json?.path ?? "/", json?.host ?? "");
  }

  override toJson(): JsonObject {
    return {
      path: this.path,
      host: this.host,
    };
  }
}

export class XHTTPStreamSettings extends CommonClass {
  path: string;
  host: string;
  mode: string;
  noGRPCHeader: boolean;
  scMinPostsIntervalMs: string;
  xmux: {
    maxConcurrency: string;
    maxConnections: number;
    cMaxReuseTimes: number;
    hMaxRequestTimes: string;
    hMaxReusableSecs: string;
    hKeepAlivePeriod: number;
  };

  constructor(
    path = "/",
    host = "",
    mode = "",
    noGRPCHeader = false,
    scMinPostsIntervalMs = "30",
    xmux = {
      maxConcurrency: "16-32",
      maxConnections: 0,
      cMaxReuseTimes: 0,
      hMaxRequestTimes: "600-900",
      hMaxReusableSecs: "1800-3000",
      hKeepAlivePeriod: 0,
    }
  ) {
    super();
    this.path = path ?? "/";
    this.host = host ?? "";
    this.mode = mode ?? "";
    this.noGRPCHeader = Boolean(noGRPCHeader);
    this.scMinPostsIntervalMs = scMinPostsIntervalMs ?? "30";
    this.xmux = {
      maxConcurrency: xmux?.maxConcurrency ?? "16-32",
      maxConnections: xmux?.maxConnections ?? 0,
      cMaxReuseTimes: xmux?.cMaxReuseTimes ?? 0,
      hMaxRequestTimes: xmux?.hMaxRequestTimes ?? "600-900",
      hMaxReusableSecs: xmux?.hMaxReusableSecs ?? "1800-3000",
      hKeepAlivePeriod: xmux?.hKeepAlivePeriod ?? 0,
    };
  }

  static override fromJson(json: any = {}): XHTTPStreamSettings {
    return new XHTTPStreamSettings(
      json?.path ?? "/",
      json?.host ?? "",
      json?.mode ?? "",
      Boolean(json?.noGRPCHeader),
      json?.scMinPostsIntervalMs ?? "30",
      json?.xmux
    );
  }

  override toJson(): JsonObject {
    return {
      path: this.path,
      host: this.host,
      mode: this.mode,
      noGRPCHeader: this.noGRPCHeader,
      scMinPostsIntervalMs: this.scMinPostsIntervalMs,
      xmux: {
        maxConcurrency: this.xmux.maxConcurrency,
        maxConnections: this.xmux.maxConnections,
        cMaxReuseTimes: this.xmux.cMaxReuseTimes,
        hMaxRequestTimes: this.xmux.hMaxRequestTimes,
        hMaxReusableSecs: this.xmux.hMaxReusableSecs,
        hKeepAlivePeriod: this.xmux.hKeepAlivePeriod,
      },
    };
  }
}

export class TlsStreamSettings extends CommonClass {
  serverName: string;
  alpn: string[];
  fingerprint: string;
  allowInsecure: boolean;
  echConfigList: string;

  constructor(
    serverName = "",
    alpn: string[] = [],
    fingerprint = "",
    allowInsecure = false,
    echConfigList = ""
  ) {
    super();
    this.serverName = serverName ?? "";
    this.alpn = alpn ?? [];
    this.fingerprint = fingerprint ?? "";
    this.allowInsecure = Boolean(allowInsecure);
    this.echConfigList = echConfigList ?? "";
  }

  static override fromJson(json: any = {}): TlsStreamSettings {
    return new TlsStreamSettings(
      json?.serverName ?? "",
      Array.isArray(json?.alpn) ? json.alpn : [],
      json?.fingerprint ?? "",
      Boolean(json?.allowInsecure),
      json?.echConfigList ?? ""
    );
  }

  override toJson(): JsonObject {
    return {
      serverName: this.serverName || undefined,
      alpn: this.alpn?.length ? this.alpn : undefined,
      fingerprint: this.fingerprint || undefined,
      allowInsecure: this.allowInsecure,
      echConfigList: this.echConfigList || undefined,
    };
  }
}

export class RealityStreamSettings extends CommonClass {
  publicKey: string;
  fingerprint: string;
  serverName: string;
  shortId: string;
  spiderX: string;
  mldsa65Verify: string;

  constructor(
    publicKey = "",
    fingerprint = "",
    serverName = "",
    shortId = "",
    spiderX = "",
    mldsa65Verify = ""
  ) {
    super();
    this.publicKey = publicKey ?? "";
    this.fingerprint = fingerprint ?? "";
    this.serverName = serverName ?? "";
    this.shortId = shortId ?? "";
    this.spiderX = spiderX ?? "";
    this.mldsa65Verify = mldsa65Verify ?? "";
  }

  static override fromJson(json: any = {}): RealityStreamSettings {
    return new RealityStreamSettings(
      json?.publicKey ?? "",
      json?.fingerprint ?? "",
      json?.serverName ?? "",
      json?.shortId ?? "",
      json?.spiderX ?? "",
      json?.mldsa65Verify ?? ""
    );
  }

  override toJson(): JsonObject {
    return {
      publicKey: this.publicKey || undefined,
      fingerprint: this.fingerprint || undefined,
      serverName: this.serverName || undefined,
      shortId: this.shortId || undefined,
      spiderX: this.spiderX || undefined,
      mldsa65Verify: this.mldsa65Verify || undefined,
    };
  }
}

export class SockoptStreamSettings extends CommonClass {
  dialerProxy: string;
  tcpFastOpen: boolean;
  tcpKeepAliveInterval: number;
  tcpMptcp: boolean;
  penetrate: boolean;
  addressPortStrategy: string;

  constructor(
    dialerProxy = "",
    tcpFastOpen = false,
    tcpKeepAliveInterval = 0,
    tcpMptcp = false,
    penetrate = false,
    addressPortStrategy = Address_Port_Strategy.NONE
  ) {
    super();
    this.dialerProxy = dialerProxy ?? "";
    this.tcpFastOpen = Boolean(tcpFastOpen);
    this.tcpKeepAliveInterval = tcpKeepAliveInterval ?? 0;
    this.tcpMptcp = Boolean(tcpMptcp);
    this.penetrate = Boolean(penetrate);
    this.addressPortStrategy = addressPortStrategy ?? Address_Port_Strategy.NONE;
  }

  static override fromJson(json: any = {}): SockoptStreamSettings {
    if (!json || Object.keys(json).length === 0) {
      return new SockoptStreamSettings();
    }
    return new SockoptStreamSettings(
      json?.dialerProxy ?? "",
      Boolean(json?.tcpFastOpen),
      json?.tcpKeepAliveInterval ?? 0,
      Boolean(json?.tcpMptcp),
      Boolean(json?.penetrate),
      json?.addressPortStrategy ?? Address_Port_Strategy.NONE
    );
  }

  override toJson(): JsonObject {
    return {
      dialerProxy: this.dialerProxy || undefined,
      tcpFastOpen: this.tcpFastOpen,
      tcpKeepAliveInterval: this.tcpKeepAliveInterval || undefined,
      tcpMptcp: this.tcpMptcp,
      penetrate: this.penetrate,
      addressPortStrategy: this.addressPortStrategy,
    };
  }
}

export class StreamSettings extends CommonClass {
  network: string;
  security: string;
  tls: TlsStreamSettings;
  reality: RealityStreamSettings;
  tcp: TcpStreamSettings;
  kcp: KcpStreamSettings;
  ws: WsStreamSettings;
  grpc: GrpcStreamSettings;
  httpupgrade: HttpUpgradeStreamSettings;
  xhttp: XHTTPStreamSettings;
  sockopt?: SockoptStreamSettings;

  constructor(
    network = "tcp",
    security = "none",
    tlsSettings = new TlsStreamSettings(),
    realitySettings = new RealityStreamSettings(),
    tcpSettings = new TcpStreamSettings(),
    kcpSettings = new KcpStreamSettings(),
    wsSettings = new WsStreamSettings(),
    grpcSettings = new GrpcStreamSettings(),
    httpupgradeSettings = new HttpUpgradeStreamSettings(),
    xhttpSettings = new XHTTPStreamSettings(),
    sockopt?: SockoptStreamSettings
  ) {
    super();
    this.network = network ?? "tcp";
    this.security = security ?? "none";
    this.tls = tlsSettings;
    this.reality = realitySettings;
    this.tcp = tcpSettings;
    this.kcp = kcpSettings;
    this.ws = wsSettings;
    this.grpc = grpcSettings;
    this.httpupgrade = httpupgradeSettings;
    this.xhttp = xhttpSettings;
    this.sockopt = sockopt;
  }

  get isTls(): boolean {
    return this.security === "tls";
  }

  get isReality(): boolean {
    return this.security === "reality";
  }

  get sockoptSwitch(): boolean {
    return this.sockopt !== undefined;
  }

  set sockoptSwitch(value: boolean) {
    this.sockopt = value ? new SockoptStreamSettings() : undefined;
  }

  static override fromJson(json: any = {}): StreamSettings {
    return new StreamSettings(
      json?.network ?? "tcp",
      json?.security ?? "none",
      TlsStreamSettings.fromJson(json?.tlsSettings),
      RealityStreamSettings.fromJson(json?.realitySettings),
      TcpStreamSettings.fromJson(json?.tcpSettings),
      KcpStreamSettings.fromJson(json?.kcpSettings),
      WsStreamSettings.fromJson(json?.wsSettings),
      GrpcStreamSettings.fromJson(json?.grpcSettings),
      HttpUpgradeStreamSettings.fromJson(json?.httpupgradeSettings),
      XHTTPStreamSettings.fromJson(json?.xhttpSettings),
      SockoptStreamSettings.fromJson(json?.sockopt)
    );
  }

  override toJson(): JsonObject {
    const network = this.network;
    return {
      network,
      security: this.security,
      tlsSettings: this.security === "tls" ? this.tls.toJson() : undefined,
      realitySettings: this.security === "reality" ? this.reality.toJson() : undefined,
      tcpSettings: network === "tcp" ? this.tcp.toJson() : undefined,
      kcpSettings: network === "kcp" ? this.kcp.toJson() : undefined,
      wsSettings: network === "ws" ? this.ws.toJson() : undefined,
      grpcSettings: network === "grpc" ? this.grpc.toJson() : undefined,
      httpupgradeSettings: network === "httpupgrade" ? this.httpupgrade.toJson() : undefined,
      xhttpSettings: network === "xhttp" ? this.xhttp.toJson() : undefined,
      sockopt: this.sockopt ? this.sockopt.toJson() : undefined,
    };
  }
}

export class Mux extends CommonClass {
  enabled: boolean;
  concurrency: number;
  xudpConcurrency: number;
  xudpProxyUDP443: string;

  constructor(enabled = false, concurrency = 8, xudpConcurrency = 16, xudpProxyUDP443 = "reject") {
    super();
    this.enabled = Boolean(enabled);
    this.concurrency = concurrency ?? 8;
    this.xudpConcurrency = xudpConcurrency ?? 16;
    this.xudpProxyUDP443 = xudpProxyUDP443 ?? "reject";
  }

  static override fromJson(json: any = {}): Mux {
    if (!json || Object.keys(json).length === 0) {
      return new Mux();
    }
    return new Mux(json?.enabled, json?.concurrency, json?.xudpConcurrency, json?.xudpProxyUDP443);
  }

  override toJson(): JsonObject {
    return {
      enabled: this.enabled,
      concurrency: this.concurrency,
      xudpConcurrency: this.xudpConcurrency,
      xudpProxyUDP443: this.xudpProxyUDP443,
    };
  }
}

export class Outbound extends CommonClass {
  tag: string;
  private _protocol: string;
  settings: any;
  stream: StreamSettings;
  sendThrough?: string;
  mux?: Mux;

  constructor(
    tag = "",
    protocol: string = Protocols.VLESS,
    settings: any = Outbound.Settings.getSettings(Protocols.VLESS),
    streamSettings: StreamSettings = new StreamSettings(),
    sendThrough?: string,
    mux: Mux | undefined = new Mux()
  ) {
    super();
    this.tag = tag ?? "";
    this._protocol = protocol ?? Protocols.VLESS;
    this.settings = settings ?? Outbound.Settings.getSettings(this._protocol);
    this.stream = streamSettings;
    this.sendThrough = sendThrough;
    this.mux = mux;
  }

  get protocol(): string {
    return this._protocol;
  }

  set protocol(protocol: string) {
    this._protocol = protocol;
    this.settings = Outbound.Settings.getSettings(protocol);
    this.stream = new StreamSettings();
  }

  canEnableTls(): boolean {
    if (![Protocols.VMess, Protocols.VLESS, Protocols.Trojan, Protocols.Shadowsocks].includes(this.protocol as any)) {
      return false;
    }
    return ["tcp", "ws", "http", "grpc", "httpupgrade", "xhttp"].includes(this.stream.network);
  }

  canEnableTlsFlow(): boolean {
    if (this.stream.security !== "none" && this.stream.network === "tcp") {
      return this.protocol === Protocols.VLESS;
    }
    return false;
  }

  canEnableReality(): boolean {
    if (![Protocols.VLESS, Protocols.Trojan].includes(this.protocol as any)) return false;
    return ["tcp", "http", "grpc", "xhttp"].includes(this.stream.network);
  }

  canEnableStream(): boolean {
    return [Protocols.VMess, Protocols.VLESS, Protocols.Trojan, Protocols.Shadowsocks].includes(this.protocol as any);
  }

  canEnableMux(): boolean {
    if (this.settings && typeof this.settings === "object" && "flow" in (this.settings as Record<string, unknown>)) {
      const flow = (this.settings as Record<string, unknown>).flow as string | undefined;
      if (flow && flow.length > 0) {
        if (this.mux) this.mux.enabled = false;
        return false;
      }
    }
    if (this.stream.network === "xhttp") {
      if (this.mux) this.mux.enabled = false;
      return false;
    }
    return [
      Protocols.VMess,
      Protocols.VLESS,
      Protocols.Trojan,
      Protocols.Shadowsocks,
      Protocols.HTTP,
      Protocols.Socks,
    ].includes(this.protocol as any);
  }

  hasVnext(): boolean {
    return [Protocols.VMess, Protocols.VLESS].includes(this.protocol as any);
  }

  hasServers(): boolean {
    return [Protocols.Trojan, Protocols.Shadowsocks, Protocols.Socks, Protocols.HTTP].includes(this.protocol as any);
  }

  hasAddressPort(): boolean {
    return [
      Protocols.DNS,
      Protocols.VMess,
      Protocols.VLESS,
      Protocols.Trojan,
      Protocols.Shadowsocks,
      Protocols.Socks,
      Protocols.HTTP,
    ].includes(this.protocol as any);
  }

  hasUsername(): boolean {
    return [Protocols.Socks, Protocols.HTTP].includes(this.protocol as any);
  }

  static override fromJson(json: any = {}): Outbound {
    return new Outbound(
      json?.tag ?? "",
      json?.protocol ?? Protocols.VLESS,
      Outbound.Settings.fromProtocol(json?.protocol ?? Protocols.VLESS, json?.settings),
      StreamSettings.fromJson(json?.streamSettings),
      json?.sendThrough ?? "",
      Mux.fromJson(json?.mux)
    );
  }

  override toJson(): JsonObject {
    let stream: JsonObject | undefined;
    if (this.canEnableStream()) {
      stream = this.stream.toJson();
    } else if (this.stream?.sockopt) {
      stream = { sockopt: this.stream.sockopt.toJson() };
    }

    return {
      tag: this.tag || undefined,
      protocol: this.protocol,
      settings: this.settings instanceof CommonClass ? (this.settings as CommonClass).toJson() : this.settings,
      streamSettings: stream,
      sendThrough: this.sendThrough || undefined,
      mux: this.mux?.enabled ? this.mux.toJson() : undefined,
    };
  }

  static fromLink(link: string): Outbound | null {
    if (!link || typeof link !== "string") return null;
    const parts = link.split("://");
    if (parts.length !== 2) return null;
    const scheme = parts[0].toLowerCase();
    try {
      switch (scheme) {
        case Protocols.VMess:
          return Outbound.fromVmessLink(JSON.parse(base64Decode(parts[1])));
        case Protocols.VLESS:
        case Protocols.Trojan:
        case "ss":
          return Outbound.fromParamLink(link);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private static fromVmessLink(json: any = {}): Outbound | null {
    if (!json) return null;
    const stream = new StreamSettings(json?.net ?? "tcp", json?.tls ?? "none");
    const network = json?.net;
    if (network === "tcp") {
      stream.tcp = new TcpStreamSettings(json?.type ?? "none", json?.host ?? "", json?.path ?? "");
    } else if (network === "kcp") {
      stream.kcp = new KcpStreamSettings();
      stream.kcp.type = json?.type ?? "none";
      stream.kcp.seed = json?.path ?? "";
    } else if (network === "ws") {
      stream.ws = new WsStreamSettings(json?.path ?? "/", json?.host ?? "");
    } else if (network === "grpc") {
      stream.grpc = new GrpcStreamSettings(json?.path ?? "", json?.authority ?? "", json?.type === "multi");
    } else if (network === "httpupgrade") {
      stream.httpupgrade = new HttpUpgradeStreamSettings(json?.path ?? "/", json?.host ?? "");
    } else if (network === "xhttp") {
      stream.xhttp = new XHTTPStreamSettings(json?.path ?? "/", json?.host ?? "", json?.mode ?? "");
    }

    if (json?.tls === "tls") {
      stream.security = "tls";
      stream.tls = new TlsStreamSettings(
        json?.sni ?? "",
        json?.alpn ? String(json.alpn).split(",") : [],
        json?.fp ?? "",
        Boolean(json?.allowInsecure)
      );
    }

    const port = Number(json?.port ?? 0);
    if (Number.isNaN(port)) return null;

    return new Outbound(
      json?.ps ?? "",
      Protocols.VMess,
      new Outbound.VmessSettings(json?.add ?? "", port, json?.id ?? "", json?.scy ?? ""),
      stream
    );
  }

  private static fromParamLink(link: string): Outbound | null {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return null;
    }

    const type = url.searchParams.get("type") ?? "tcp";
    const security = url.searchParams.get("security") ?? "none";
    const stream = new StreamSettings(type, security);

    const headerType = url.searchParams.get("headerType") ?? undefined;
    const host = url.searchParams.get("host") ?? undefined;
    const path = url.searchParams.get("path") ?? undefined;
    const mode = url.searchParams.get("mode") ?? undefined;

    if (type === "tcp" || type === "none") {
      stream.tcp = new TcpStreamSettings(headerType ?? "none", host ?? "", path ?? "");
    } else if (type === "kcp") {
      stream.kcp = new KcpStreamSettings();
      stream.kcp.type = headerType ?? "none";
      stream.kcp.seed = path ?? "";
    } else if (type === "ws") {
      stream.ws = new WsStreamSettings(path ?? "/", host ?? "");
    } else if (type === "grpc") {
      stream.grpc = new GrpcStreamSettings(
        url.searchParams.get("serviceName") ?? "",
        url.searchParams.get("authority") ?? "",
        url.searchParams.get("mode") === "multi"
      );
    } else if (type === "httpupgrade") {
      stream.httpupgrade = new HttpUpgradeStreamSettings(path ?? "/", host ?? "");
    } else if (type === "xhttp") {
      stream.xhttp = new XHTTPStreamSettings(path ?? "/", host ?? "", mode ?? "");
    }

    if (security === "tls") {
      const fp = url.searchParams.get("fp") ?? "none";
      const alpn = url.searchParams.get("alpn");
      const allowInsecure = url.searchParams.get("allowInsecure");
      const sni = url.searchParams.get("sni") ?? "";
      const ech = url.searchParams.get("ech") ?? "";
      stream.tls = new TlsStreamSettings(sni, alpn ? alpn.split(",") : [], fp, allowInsecure === "1", ech);
    }

    if (security === "reality") {
      const pbk = url.searchParams.get("pbk") ?? "";
      const fp = url.searchParams.get("fp") ?? "";
      const sni = url.searchParams.get("sni") ?? "";
      const sid = url.searchParams.get("sid") ?? "";
      const spx = url.searchParams.get("spx") ?? "";
      const pqv = url.searchParams.get("pqv") ?? "";
      stream.reality = new RealityStreamSettings(pbk, fp, sni, sid, spx, pqv);
    }

    const regex = /([^@]+):\/\/([^@]+)@(.+):(\d+)(.*)$/;
    const match = link.match(regex);
    if (!match) return null;
    let [, protocol, userData, address, portString] = match;

    let port = Number(portString);
    if (Number.isNaN(port)) port = 0;

    if (protocol === "ss") {
      protocol = Protocols.Shadowsocks;
      userData = base64Decode(userData);
    }

    let settings: CommonClass | null = null;
    switch (protocol) {
      case Protocols.VLESS: {
        const encryption = url.searchParams.get("encryption") ?? "none";
        settings = new Outbound.VLESSSettings(address, port, userData, url.searchParams.get("flow") ?? "", encryption);
        break;
      }
      case Protocols.Trojan:
        settings = new Outbound.TrojanSettings(address, port, userData);
        break;
      case Protocols.Shadowsocks: {
        const parts = userData.split(":");
        const method = parts.shift() ?? "";
        settings = new Outbound.ShadowsocksSettings(address, port, parts.join(":"), method, true);
        break;
      }
      default:
        return null;
    }

    const remark = decodeURIComponent(url.hash ?? "");
    const tag = remark.length > 1 ? remark.substring(1) : `out-${protocol}-${port}`;
    return new Outbound(tag, protocol, settings, stream);
  }

  // Nested classes ---------------------------------------------------------
  static Settings = class Settings extends CommonClass {
    protocol: string;

    constructor(protocol: string) {
      super();
      this.protocol = protocol;
    }

    static getSettings(protocol: string): CommonClass | null {
      switch (protocol) {
        case Protocols.Freedom:
          return new Outbound.FreedomSettings();
        case Protocols.Blackhole:
          return new Outbound.BlackholeSettings();
        case Protocols.DNS:
          return new Outbound.DNSSettings();
        case Protocols.VMess:
          return new Outbound.VmessSettings();
        case Protocols.VLESS:
          return new Outbound.VLESSSettings();
        case Protocols.Trojan:
          return new Outbound.TrojanSettings();
        case Protocols.Shadowsocks:
          return new Outbound.ShadowsocksSettings();
        case Protocols.Socks:
          return new Outbound.SocksSettings();
        case Protocols.HTTP:
          return new Outbound.HttpSettings();
        case Protocols.Wireguard:
          return new Outbound.WireguardSettings();
        default:
          return null;
      }
    }

    static fromProtocol(protocol: string, json: any): CommonClass | null {
      switch (protocol) {
        case Protocols.Freedom:
          return Outbound.FreedomSettings.fromJson(json);
        case Protocols.Blackhole:
          return Outbound.BlackholeSettings.fromJson(json);
        case Protocols.DNS:
          return Outbound.DNSSettings.fromJson(json);
        case Protocols.VMess:
          return Outbound.VmessSettings.fromJson(json);
        case Protocols.VLESS:
          return Outbound.VLESSSettings.fromJson(json);
        case Protocols.Trojan:
          return Outbound.TrojanSettings.fromJson(json);
        case Protocols.Shadowsocks:
          return Outbound.ShadowsocksSettings.fromJson(json);
        case Protocols.Socks:
          return Outbound.SocksSettings.fromJson(json);
        case Protocols.HTTP:
          return Outbound.HttpSettings.fromJson(json);
        case Protocols.Wireguard:
          return Outbound.WireguardSettings.fromJson(json);
        default:
          return null;
      }
    }

    override toJson(): JsonObject {
      return {};
    }
  };

  static FreedomSettings = class FreedomSettings extends CommonClass {
    domainStrategy: string;
    redirect: string;
    fragment: JsonObject;
    noises: InstanceType<typeof Outbound.FreedomSettings.Noise>[];

    constructor(domainStrategy = "", redirect = "", fragment: JsonObject = {}, noises = []) {
      super();
      this.domainStrategy = domainStrategy ?? "";
      this.redirect = redirect ?? "";
      this.fragment = fragment ?? {};
      this.noises = noises ?? [];
    }

    addNoise(): void {
      this.noises.push(new Outbound.FreedomSettings.Noise());
    }

    delNoise(index: number): void {
      this.noises.splice(index, 1);
    }

    static override fromJson(json: any = {}) {
      return new FreedomSettings(
        json?.domainStrategy ?? "",
        json?.redirect ?? "",
        json?.fragment ? FreedomSettings.Fragment.fromJson(json.fragment) : {},
        Array.isArray(json?.noises)
          ? json.noises.map((noise: unknown) => FreedomSettings.Noise.fromJson(noise))
          : []
      );
    }

    override toJson(): JsonObject {
      return {
        domainStrategy: ObjectUtil.isEmpty(this.domainStrategy) ? undefined : this.domainStrategy,
        redirect: ObjectUtil.isEmpty(this.redirect) ? undefined : this.redirect,
        fragment: Object.keys(this.fragment).length === 0 ? undefined : this.fragment,
        noises: this.noises.length === 0 ? undefined : CommonClass.toJsonArray(this.noises),
      };
    }

    static Fragment = class Fragment extends CommonClass {
      packets: string;
      length: string;
      interval: string;
      maxSplit: string;

      constructor(packets = "1-3", length = "", interval = "", maxSplit = "") {
        super();
        this.packets = packets ?? "1-3";
        this.length = length ?? "";
        this.interval = interval ?? "";
        this.maxSplit = maxSplit ?? "";
      }

      static override fromJson(json: any = {}) {
        return new Fragment(
          json?.packets ?? "1-3",
          json?.length ?? "",
          json?.interval ?? "",
          json?.maxSplit ?? ""
        );
      }
    };

    static Noise = class Noise extends CommonClass {
      type: string;
      packet: string;
      delay: string;
      applyTo: string;

      constructor(type = "rand", packet = "10-20", delay = "10-16", applyTo = "ip") {
        super();
        this.type = type ?? "rand";
        this.packet = packet ?? "10-20";
        this.delay = delay ?? "10-16";
        this.applyTo = applyTo ?? "ip";
      }

      static override fromJson(json: any = {}) {
        return new Noise(
          json?.type ?? "rand",
          json?.packet ?? "10-20",
          json?.delay ?? "10-16",
          json?.applyTo ?? "ip"
        );
      }

      override toJson(): JsonObject {
        return {
          type: this.type,
          packet: this.packet,
          delay: this.delay,
          applyTo: this.applyTo,
        };
      }
    };
  };

  static BlackholeSettings = class BlackholeSettings extends CommonClass {
    type?: string;

    constructor(type?: string) {
      super();
      this.type = type;
    }

    static override fromJson(json: any = {}) {
      return new BlackholeSettings(json?.response?.type);
    }

    override toJson(): JsonObject {
      return {
        response: ObjectUtil.isEmpty(this.type) ? undefined : { type: this.type },
      };
    }
  };

  static DNSSettings = class DNSSettings extends CommonClass {
    network: string;
    address: string;
    port: number;
    nonIPQuery: string;
    blockTypes: string[];

    constructor(network = "udp", address = "", port = 53, nonIPQuery = "reject", blockTypes: string[] = []) {
      super();
      this.network = network ?? "udp";
      this.address = address ?? "";
      this.port = port ?? 53;
      this.nonIPQuery = nonIPQuery ?? "reject";
      this.blockTypes = blockTypes ?? [];
    }

    static override fromJson(json: any = {}) {
      return new DNSSettings(
        json?.network ?? "udp",
        json?.address ?? "",
        json?.port ?? 53,
        json?.nonIPQuery ?? "reject",
        Array.isArray(json?.blockTypes) ? json.blockTypes : []
      );
    }
  };

  static VmessSettings = class VmessSettings extends CommonClass {
    address: string;
    port: number;
    id: string;
    security: string;

    constructor(address = "", port = 0, id = "", security = "") {
      super();
      this.address = address ?? "";
      this.port = port ?? 0;
      this.id = id ?? "";
      this.security = security ?? "";
    }

    static override fromJson(json: any = {}) {
      if (ObjectUtil.isArrEmpty(json?.vnext)) return new Outbound.VmessSettings();
      const server = json.vnext[0];
      const user = Array.isArray(server?.users) && server.users[0] ? server.users[0] : {};
      return new Outbound.VmessSettings(server?.address ?? "", server?.port ?? 0, user?.id ?? "", user?.security ?? "");
    }

    override toJson(): JsonObject {
      return {
        vnext: [
          {
            address: this.address,
            port: this.port,
            users: [{ id: this.id, security: this.security }],
          },
        ],
      };
    }
  };

  static VLESSSettings = class VLESSSettings extends CommonClass {
    address: string;
    port: number;
    id: string;
    flow: string;
    encryption: string;

    constructor(address = "", port = 0, id = "", flow = "", encryption = "") {
      super();
      this.address = address ?? "";
      this.port = port ?? 0;
      this.id = id ?? "";
      this.flow = flow ?? "";
      this.encryption = encryption ?? "";
    }

    static override fromJson(json: any = {}) {
      if (ObjectUtil.isArrEmpty(json?.vnext)) return new Outbound.VLESSSettings();
      const server = json.vnext[0];
      const user = Array.isArray(server?.users) && server.users[0] ? server.users[0] : {};
      return new Outbound.VLESSSettings(
        server?.address ?? "",
        server?.port ?? 0,
        user?.id ?? "",
        user?.flow ?? "",
        user?.encryption ?? ""
      );
    }

    override toJson(): JsonObject {
      return {
        vnext: [
          {
            address: this.address,
            port: this.port,
            users: [{ id: this.id, flow: this.flow, encryption: this.encryption }],
          },
        ],
      };
    }
  };

  static TrojanSettings = class TrojanSettings extends CommonClass {
    address: string;
    port: number;
    password: string;

    constructor(address = "", port = 0, password = "") {
      super();
      this.address = address ?? "";
      this.port = port ?? 0;
      this.password = password ?? "";
    }

    static override fromJson(json: any = {}) {
      if (ObjectUtil.isArrEmpty(json?.servers)) return new Outbound.TrojanSettings();
      const server = json.servers[0];
      return new Outbound.TrojanSettings(server?.address ?? "", server?.port ?? 0, server?.password ?? "");
    }

    override toJson(): JsonObject {
      return {
        servers: [
          {
            address: this.address,
            port: this.port,
            password: this.password,
          },
        ],
      };
    }
  };

  static ShadowsocksSettings = class ShadowsocksSettings extends CommonClass {
    address: string;
    port: number;
    password: string;
    method: string;
    uot?: boolean;
    UoTVersion?: string;

    constructor(
      address = "",
      port = 0,
      password = "",
      method = "",
      uot?: boolean,
      UoTVersion?: string
    ) {
      super();
      this.address = address ?? "";
      this.port = port ?? 0;
      this.password = password ?? "";
      this.method = method ?? "";
      this.uot = uot;
      this.UoTVersion = UoTVersion;
    }

    static override fromJson(json: any = {}) {
      let servers = json?.servers;
      if (ObjectUtil.isArrEmpty(servers)) servers = [{}];
      const server = servers[0];
      return new Outbound.ShadowsocksSettings(
        server?.address ?? "",
        server?.port ?? 0,
        server?.password ?? "",
        server?.method ?? "",
        server?.uot,
        server?.UoTVersion
      );
    }

    override toJson(): JsonObject {
      return {
        servers: [
          {
            address: this.address,
            port: this.port,
            password: this.password,
            method: this.method,
            uot: this.uot,
            UoTVersion: this.UoTVersion,
          },
        ],
      };
    }
  };

  static SocksSettings = class SocksSettings extends CommonClass {
    address: string;
    port: number;
    user: string;
    pass: string;

    constructor(address = "", port = 0, user = "", pass = "") {
      super();
      this.address = address ?? "";
      this.port = port ?? 0;
      this.user = user ?? "";
      this.pass = pass ?? "";
    }

    static override fromJson(json: any = {}) {
      let servers = json?.servers;
      if (ObjectUtil.isArrEmpty(servers)) servers = [{ users: [{}] }];
      const server = servers[0];
      const users = Array.isArray(server?.users) && server.users[0] ? server.users[0] : {};
      return new Outbound.SocksSettings(
        server?.address ?? "",
        server?.port ?? 0,
        users?.user ?? "",
        users?.pass ?? ""
      );
    }

    override toJson(): JsonObject {
      return {
        servers: [
          {
            address: this.address,
            port: this.port,
            users: ObjectUtil.isEmpty(this.user) ? [] : [{ user: this.user, pass: this.pass }],
          },
        ],
      };
    }
  };

  static HttpSettings = class HttpSettings extends CommonClass {
    address: string;
    port: number;
    user: string;
    pass: string;

    constructor(address = "", port = 0, user = "", pass = "") {
      super();
      this.address = address ?? "";
      this.port = port ?? 0;
      this.user = user ?? "";
      this.pass = pass ?? "";
    }

    static override fromJson(json: any = {}) {
      let servers = json?.servers;
      if (ObjectUtil.isArrEmpty(servers)) servers = [{ users: [{}] }];
      const server = servers[0];
      const users = Array.isArray(server?.users) && server.users[0] ? server.users[0] : {};
      return new Outbound.HttpSettings(
        server?.address ?? "",
        server?.port ?? 0,
        users?.user ?? "",
        users?.pass ?? ""
      );
    }

    override toJson(): JsonObject {
      return {
        servers: [
          {
            address: this.address,
            port: this.port,
            users: ObjectUtil.isEmpty(this.user) ? [] : [{ user: this.user, pass: this.pass }],
          },
        ],
      };
    }
  };

  static WireguardSettings = class WireguardSettings extends CommonClass {
    mtu: number;
    secretKey: string;
    pubKey: string;
    address: string;
    workers: number;
    domainStrategy: string;
    reserved: string;
    peers: InstanceType<typeof WireguardSettings.Peer>[];
    noKernelTun: boolean;

    constructor(
      mtu = 1420,
      secretKey = "",
      address: string | string[] = [""],
      workers = 2,
      domainStrategy = "",
      reserved: string | number[] = "",
      peers: InstanceType<typeof WireguardSettings.Peer>[] = [new WireguardSettings.Peer()],
      noKernelTun = false
    ) {
      super();
      this.mtu = mtu ?? 1420;
      this.secretKey = secretKey ?? "";
      this.pubKey = this.secretKey.length > 0 ? tryGetWireguardPublicKey(this.secretKey) : "";
      this.address = Array.isArray(address) ? address.join(",") : address ?? "";
      this.workers = workers ?? 2;
      this.domainStrategy = domainStrategy ?? "";
      this.reserved = Array.isArray(reserved) ? reserved.join(",") : reserved ?? "";
      this.peers = peers ?? [new WireguardSettings.Peer()];
      this.noKernelTun = Boolean(noKernelTun);
    }

    addPeer(): void {
      this.peers.push(new WireguardSettings.Peer());
    }

    delPeer(index: number): void {
      this.peers.splice(index, 1);
    }

    static override fromJson(json: any = {}) {
      return new WireguardSettings(
        json?.mtu ?? 1420,
        json?.secretKey ?? "",
        json?.address ?? [""],
        json?.workers ?? 2,
        json?.domainStrategy ?? "",
        json?.reserved ?? "",
        Array.isArray(json?.peers)
          ? json.peers.map((peer: unknown) => WireguardSettings.Peer.fromJson(peer))
          : [new WireguardSettings.Peer()],
        json?.noKernelTun ?? false
      );
    }

    override toJson(): JsonObject {
      return {
        mtu: this.mtu || undefined,
        secretKey: this.secretKey,
        address: this.address ? this.address.split(",") : [],
        workers: this.workers || undefined,
        domainStrategy: WireguardDomainStrategy.includes(this.domainStrategy as never) ? this.domainStrategy : undefined,
        reserved: this.reserved
          ? this.reserved.split(",").map((value) => Number(value)).filter((value) => !Number.isNaN(value))
          : undefined,
        peers: CommonClass.toJsonArray(this.peers),
        noKernelTun: this.noKernelTun,
      };
    }

    static Peer = class Peer extends CommonClass {
      publicKey: string;
      psk: string;
      allowedIPs: string[];
      endpoint: string;
      keepAlive: number;

      constructor(publicKey = "", psk = "", allowedIPs: string[] = ["0.0.0.0/0", "::/0"], endpoint = "", keepAlive = 0) {
        super();
        this.publicKey = publicKey ?? "";
        this.psk = psk ?? "";
        this.allowedIPs = allowedIPs ?? ["0.0.0.0/0", "::/0"];
        this.endpoint = endpoint ?? "";
        this.keepAlive = keepAlive ?? 0;
      }

      static override fromJson(json: any = {}) {
        return new Outbound.WireguardSettings.Peer(
          json?.publicKey ?? "",
          json?.preSharedKey ?? "",
          Array.isArray(json?.allowedIPs) ? json.allowedIPs : ["0.0.0.0/0", "::/0"],
          json?.endpoint ?? "",
          json?.keepAlive ?? 0
        );
      }

      override toJson(): JsonObject {
        return {
          publicKey: this.publicKey,
          preSharedKey: this.psk.length > 0 ? this.psk : undefined,
          allowedIPs: this.allowedIPs?.length ? this.allowedIPs : undefined,
          endpoint: this.endpoint,
          keepAlive: this.keepAlive || undefined,
        };
      }
    };
  };
}

export namespace Outbound {
  export type Settings = InstanceType<typeof Outbound.Settings>;
  export type FreedomSettings = InstanceType<typeof Outbound.FreedomSettings>;
  export type FreedomFragment = InstanceType<typeof Outbound.FreedomSettings.Fragment>;
  export type FreedomNoise = InstanceType<typeof Outbound.FreedomSettings.Noise>;
  export type BlackholeSettings = InstanceType<typeof Outbound.BlackholeSettings>;
  export type DNSSettings = InstanceType<typeof Outbound.DNSSettings>;
  export type VmessSettings = InstanceType<typeof Outbound.VmessSettings>;
  export type VLESSSettings = InstanceType<typeof Outbound.VLESSSettings>;
  export type TrojanSettings = InstanceType<typeof Outbound.TrojanSettings>;
  export type ShadowsocksSettings = InstanceType<typeof Outbound.ShadowsocksSettings>;
  export type SocksSettings = InstanceType<typeof Outbound.SocksSettings>;
  export type HttpSettings = InstanceType<typeof Outbound.HttpSettings>;
  export type WireguardSettings = InstanceType<typeof Outbound.WireguardSettings>;
  export type WireguardPeer = InstanceType<typeof Outbound.WireguardSettings.Peer>;
}

export class SizeFormatter {
  static sizeFormat(size: number): string {
    if (size <= 0 || Number.isNaN(size)) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let index = 0;
    let n = size;
    while (n >= 1024 && index < units.length - 1) {
      n /= 1024;
      index++;
    }
    return `${n.toFixed(2)} ${units[index]}`;
  }
}
