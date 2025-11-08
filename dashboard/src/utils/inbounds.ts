import { ALPN_OPTION, UTLS_FINGERPRINT } from "utils/outbound";

export type Protocol = "vmess" | "vless" | "trojan" | "shadowsocks";
export type StreamNetwork =
  | "tcp"
  | "ws"
  | "grpc"
  | "kcp"
  | "quic"
  | "httpupgrade"
  | "splithttp";
export type StreamSecurity = "none" | "tls" | "reality";

export type RawInbound = {
  tag: string;
  listen?: string;
  port: number | string;
  protocol: string;
  settings: Record<string, any>;
  streamSettings?: Record<string, any>;
  sniffing?: Record<string, any>;
};

export type FallbackForm = {
  dest: string;
  path: string;
  type: string;
  alpn: string;
  xver: string;
};

export type SockoptFormValues = {
  acceptProxyProtocol: boolean;
  tcpFastOpen: boolean;
  mark: string;
  tproxy: "" | "off" | "redirect" | "tproxy";
  tcpMptcp: boolean;
  penetrate: boolean;
  domainStrategy: string;
  tcpMaxSeg: string;
  dialerProxy: string;
  tcpKeepAliveInterval: string;
  tcpKeepAliveIdle: string;
  tcpUserTimeout: string;
  tcpcongestion: string;
  V6Only: boolean;
  tcpWindowClamp: string;
  interfaceName: string;
};

export type InboundFormValues = {
  tag: string;
  listen: string;
  port: string;
  protocol: Protocol;
  disableInsecureEncryption: boolean;
  vlessDecryption: string;
  vlessEncryption: string;
  fallbacks: FallbackForm[];
  shadowsocksNetwork: string;
  sniffingEnabled: boolean;
  sniffingDestinations: string[];
  sniffingRouteOnly: boolean;
  sniffingMetadataOnly: boolean;
  streamNetwork: StreamNetwork;
  streamSecurity: StreamSecurity;
  tlsServerName: string;
  tlsAlpn: string[];
  tlsAllowInsecure: boolean;
  tlsFingerprint: string;
  realityPrivateKey: string;
  realityServerNames: string;
  realityShortIds: string;
  realityDest: string;
  realitySpiderX: string;
  realityXver: string;
  wsPath: string;
  wsHost: string;
  tcpHeaderType: "none" | "http";
  tcpHttpHosts: string;
  tcpHttpPath: string;
  grpcServiceName: string;
  grpcAuthority: string;
  grpcMultiMode: boolean;
  kcpHeaderType: string;
  kcpSeed: string;
  quicSecurity: string;
  quicKey: string;
  quicHeaderType: string;
  httpupgradePath: string;
  httpupgradeHost: string;
  splithttpPath: string;
  splithttpHost: string;
  vlessSelectedAuth: string;
  sockoptEnabled: boolean;
  sockopt: SockoptFormValues;
};

export const sniffingOptions = [
  { value: "http", label: "HTTP" },
  { value: "tls", label: "TLS" },
  { value: "quic", label: "QUIC" },
  { value: "fakedns", label: "FakeDNS" },
] as const;

export const tlsAlpnOptions = Object.values(ALPN_OPTION);
export const tlsFingerprintOptions = Object.values(UTLS_FINGERPRINT);

export const protocolOptions: Protocol[] = ["vmess", "vless", "trojan", "shadowsocks"];
export const streamNetworks: StreamNetwork[] = [
  "tcp",
  "ws",
  "grpc",
  "kcp",
  "quic",
  "httpupgrade",
  "splithttp",
];
export const streamSecurityOptions: StreamSecurity[] = ["none", "tls", "reality"];

const splitLines = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const joinLines = (values: string[] | undefined): string =>
  values && values.length ? values.join("\n") : "";

const toInputValue = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
};

const createDefaultSockopt = (): SockoptFormValues => ({
  acceptProxyProtocol: false,
  tcpFastOpen: false,
  mark: "",
  tproxy: "off",
  tcpMptcp: false,
  penetrate: false,
  domainStrategy: "",
  tcpMaxSeg: "",
  dialerProxy: "",
  tcpKeepAliveInterval: "",
  tcpKeepAliveIdle: "",
  tcpUserTimeout: "",
  tcpcongestion: "",
  V6Only: false,
  tcpWindowClamp: "",
  interfaceName: "",
});

const parsePort = (value: string): number | string => {
  if (!value) return 0;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return numeric;
  }
  return value.trim();
};

const cleanObject = (value: Record<string, any>) => {
  Object.keys(value).forEach((key) => {
    const current = value[key];
    if (
      current === undefined ||
      current === null ||
      (typeof current === "string" && current.trim() === "") ||
      (Array.isArray(current) && current.length === 0)
    ) {
      delete value[key];
    }
  });
  return value;
};

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (value === "" || value === null || typeof value === "undefined") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildSockoptSettings = (values: InboundFormValues) => {
  if (!values.sockoptEnabled) {
    return undefined;
  }
  const sockopt = values.sockopt;
  const payload = {
    acceptProxyProtocol: sockopt.acceptProxyProtocol,
    tcpFastOpen: sockopt.tcpFastOpen,
    mark: parseOptionalNumber(sockopt.mark),
    tproxy: sockopt.tproxy || undefined,
    tcpMptcp: sockopt.tcpMptcp,
    penetrate: sockopt.penetrate,
    domainStrategy: sockopt.domainStrategy || undefined,
    tcpMaxSeg: parseOptionalNumber(sockopt.tcpMaxSeg),
    dialerProxy: sockopt.dialerProxy || undefined,
    tcpKeepAliveInterval: parseOptionalNumber(sockopt.tcpKeepAliveInterval),
    tcpKeepAliveIdle: parseOptionalNumber(sockopt.tcpKeepAliveIdle),
    tcpUserTimeout: parseOptionalNumber(sockopt.tcpUserTimeout),
    tcpcongestion: sockopt.tcpcongestion || undefined,
    V6Only: sockopt.V6Only,
    tcpWindowClamp: parseOptionalNumber(sockopt.tcpWindowClamp),
    interface: sockopt.interfaceName || undefined,
  };
  return cleanObject(payload);
};

export const createDefaultInboundForm = (protocol: Protocol = "vless"): InboundFormValues => ({
  tag: "",
  listen: "",
  port: "",
  protocol,
  disableInsecureEncryption: true,
  vlessDecryption: "none",
  vlessEncryption: "",
  fallbacks: [],
  shadowsocksNetwork: "tcp,udp",
  sniffingEnabled: true,
  sniffingDestinations: ["http", "tls"],
  sniffingRouteOnly: false,
  sniffingMetadataOnly: false,
  streamNetwork: "tcp",
  streamSecurity: "tls",
  tlsServerName: "",
  tlsAlpn: [],
  tlsAllowInsecure: false,
  tlsFingerprint: "",
  realityPrivateKey: "",
  realityServerNames: "",
  realityShortIds: "",
  realityDest: "",
  realitySpiderX: "",
  realityXver: "0",
  wsPath: "/",
  wsHost: "",
  tcpHeaderType: "none",
  tcpHttpHosts: "",
  tcpHttpPath: "/",
  grpcServiceName: "",
  grpcAuthority: "",
  grpcMultiMode: false,
  kcpHeaderType: "none",
  kcpSeed: "",
  quicSecurity: "",
  quicKey: "",
  quicHeaderType: "none",
  httpupgradePath: "/",
  httpupgradeHost: "",
  splithttpPath: "/",
  splithttpHost: "",
  vlessSelectedAuth: "",
  sockoptEnabled: false,
  sockopt: createDefaultSockopt(),
});

const fallbackToForm = (fallback: Record<string, any>): FallbackForm => ({
  dest: fallback?.dest?.toString() ?? "",
  path: fallback?.path ?? "",
  type: fallback?.type ?? "",
  alpn: Array.isArray(fallback?.alpn) ? fallback.alpn.join(",") : fallback?.alpn ?? "",
  xver: fallback?.xver?.toString() ?? "",
});

const formToFallback = (fallback: FallbackForm) => {
  const payload: Record<string, any> = {
    dest: fallback.dest?.trim(),
    path: fallback.path?.trim(),
    type: fallback.type?.trim(),
    xver: fallback.xver ? Number(fallback.xver) : undefined,
  };
  if (fallback.alpn) {
    payload.alpn = fallback.alpn.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return cleanObject(payload);
};

export const rawInboundToFormValues = (raw: RawInbound): InboundFormValues => {
  const protocol = protocolOptions.includes(raw.protocol as Protocol)
    ? (raw.protocol as Protocol)
    : "vless";
  const base = createDefaultInboundForm(protocol);
  const settings = raw.settings ?? {};
  const sniffing = raw.sniffing ?? {};
  const stream = raw.streamSettings ?? {};
  const tlsSettings = stream.tlsSettings ?? {};
  const realitySettings = stream.realitySettings ?? {};

  return {
    ...base,
    tag: raw.tag ?? "",
    listen: raw.listen ?? "",
    port: raw.port?.toString() ?? "",
    disableInsecureEncryption: Boolean(settings.disableInsecureEncryption ?? base.disableInsecureEncryption),
    vlessDecryption: settings.decryption ?? base.vlessDecryption,
    vlessEncryption: settings.encryption ?? base.vlessEncryption,
    fallbacks: Array.isArray(settings.fallbacks)
      ? settings.fallbacks.map((item: Record<string, any>) => fallbackToForm(item))
      : base.fallbacks,
    shadowsocksNetwork: settings.network ?? base.shadowsocksNetwork,
    sniffingEnabled: Boolean(sniffing.enabled ?? base.sniffingEnabled),
    sniffingDestinations: Array.isArray(sniffing.destOverride) && sniffing.destOverride.length
      ? sniffing.destOverride
      : base.sniffingDestinations,
    sniffingRouteOnly: Boolean(sniffing.routeOnly ?? base.sniffingRouteOnly),
    sniffingMetadataOnly: Boolean(sniffing.metadataOnly ?? base.sniffingMetadataOnly),
    streamNetwork: stream.network ?? base.streamNetwork,
    streamSecurity: stream.security ?? base.streamSecurity,
    tlsServerName: tlsSettings.serverName ?? base.tlsServerName,
    tlsAlpn: Array.isArray(tlsSettings.alpn) ? tlsSettings.alpn : base.tlsAlpn,
    tlsAllowInsecure: Boolean(tlsSettings.allowInsecure ?? base.tlsAllowInsecure),
    tlsFingerprint: tlsSettings.fingerprint ?? base.tlsFingerprint,
    realityPrivateKey: realitySettings.privateKey ?? base.realityPrivateKey,
    realityServerNames: joinLines(realitySettings.serverNames),
    realityShortIds: joinLines(realitySettings.shortIds),
    realityDest: realitySettings.dest ?? base.realityDest,
    realitySpiderX: realitySettings.spiderX ?? base.realitySpiderX,
    realityXver: realitySettings.xver?.toString() ?? base.realityXver,
    wsPath: stream?.wsSettings?.path ?? base.wsPath,
    wsHost: stream?.wsSettings?.headers?.Host ?? base.wsHost,
    tcpHeaderType: stream?.tcpSettings?.header?.type ?? base.tcpHeaderType,
    tcpHttpHosts: joinLines(stream?.tcpSettings?.header?.request?.headers?.Host),
    tcpHttpPath: Array.isArray(stream?.tcpSettings?.header?.request?.path)
      ? stream.tcpSettings.header.request.path[0]
      : base.tcpHttpPath,
    grpcServiceName: stream?.grpcSettings?.serviceName ?? base.grpcServiceName,
    grpcAuthority: stream?.grpcSettings?.authority ?? base.grpcAuthority,
    grpcMultiMode: Boolean(stream?.grpcSettings?.multiMode ?? base.grpcMultiMode),
    kcpHeaderType: stream?.kcpSettings?.header?.type ?? base.kcpHeaderType,
    kcpSeed: stream?.kcpSettings?.seed ?? base.kcpSeed,
    quicSecurity: stream?.quicSettings?.security ?? base.quicSecurity,
    quicKey: stream?.quicSettings?.key ?? base.quicKey,
    quicHeaderType: stream?.quicSettings?.header?.type ?? base.quicHeaderType,
    httpupgradePath: stream?.httpupgradeSettings?.path ?? base.httpupgradePath,
    httpupgradeHost: stream?.httpupgradeSettings?.host ?? base.httpupgradeHost,
    splithttpPath: stream?.splithttpSettings?.path ?? base.splithttpPath,
    splithttpHost: stream?.splithttpSettings?.host ?? base.splithttpHost,
    vlessSelectedAuth: settings.selectedAuth ?? base.vlessSelectedAuth,
    sockoptEnabled: Boolean(stream?.sockopt),
    sockopt: (() => {
      const defaults = createDefaultSockopt();
      const sockopt = stream?.sockopt ?? {};
      defaults.acceptProxyProtocol = Boolean(sockopt.acceptProxyProtocol);
      defaults.tcpFastOpen = Boolean(sockopt.tcpFastOpen);
      defaults.mark = toInputValue(sockopt.mark);
      defaults.tproxy = (sockopt.tproxy as SockoptFormValues["tproxy"]) ?? defaults.tproxy;
      defaults.tcpMptcp = Boolean(sockopt.tcpMptcp);
      defaults.penetrate = Boolean(sockopt.penetrate);
      defaults.domainStrategy = sockopt.domainStrategy ?? defaults.domainStrategy;
      defaults.tcpMaxSeg = toInputValue(sockopt.tcpMaxSeg);
      defaults.dialerProxy = sockopt.dialerProxy ?? defaults.dialerProxy;
      defaults.tcpKeepAliveInterval = toInputValue(sockopt.tcpKeepAliveInterval);
      defaults.tcpKeepAliveIdle = toInputValue(sockopt.tcpKeepAliveIdle);
      defaults.tcpUserTimeout = toInputValue(sockopt.tcpUserTimeout);
      defaults.tcpcongestion = sockopt.tcpcongestion ?? defaults.tcpcongestion;
      defaults.V6Only = Boolean(sockopt.V6Only);
      defaults.tcpWindowClamp = toInputValue(sockopt.tcpWindowClamp);
      defaults.interfaceName = sockopt.interface ?? defaults.interfaceName;
      return defaults;
    })(),
  };
};

const buildStreamSettings = (values: InboundFormValues): Record<string, any> => {
  const stream: Record<string, any> = {
    network: values.streamNetwork,
    security: values.streamSecurity,
  };

  if (values.streamNetwork === "ws") {
    stream.wsSettings = cleanObject({
      path: values.wsPath || undefined,
      headers: values.wsHost ? { Host: values.wsHost } : undefined,
    });
  }

  if (values.streamNetwork === "tcp") {
    if (values.tcpHeaderType === "http") {
      stream.tcpSettings = {
        header: {
          type: "http",
          request: {
            path: values.tcpHttpPath ? [values.tcpHttpPath] : [],
            headers: values.tcpHttpHosts ? { Host: splitLines(values.tcpHttpHosts) } : {},
          },
        },
      };
    } else {
      stream.tcpSettings = { header: { type: "none" } };
    }
  }

  if (values.streamNetwork === "grpc") {
    stream.grpcSettings = cleanObject({
      serviceName: values.grpcServiceName,
      authority: values.grpcAuthority,
      multiMode: values.grpcMultiMode,
    });
  }

  if (values.streamNetwork === "kcp") {
    stream.kcpSettings = cleanObject({
      header: { type: values.kcpHeaderType },
      seed: values.kcpSeed,
    });
  }

  if (values.streamNetwork === "quic") {
    stream.quicSettings = cleanObject({
      security: values.quicSecurity,
      key: values.quicKey,
      header: { type: values.quicHeaderType },
    });
  }

  if (values.streamNetwork === "httpupgrade") {
    stream.httpupgradeSettings = cleanObject({
      path: values.httpupgradePath,
      host: values.httpupgradeHost,
    });
  }

  if (values.streamNetwork === "splithttp") {
    stream.splithttpSettings = cleanObject({
      path: values.splithttpPath,
      host: values.splithttpHost,
    });
  }

  if (values.streamSecurity === "tls") {
    stream.tlsSettings = cleanObject({
      serverName: values.tlsServerName || undefined,
      alpn: values.tlsAlpn?.length ? values.tlsAlpn : undefined,
      allowInsecure: values.tlsAllowInsecure || undefined,
      fingerprint: values.tlsFingerprint || undefined,
    });
  }

  if (values.streamSecurity === "reality") {
    stream.realitySettings = cleanObject({
      privateKey: values.realityPrivateKey || undefined,
      serverNames: splitLines(values.realityServerNames),
      shortIds: splitLines(values.realityShortIds),
      dest: values.realityDest || undefined,
      spiderX: values.realitySpiderX || undefined,
      xver: values.realityXver ? Number(values.realityXver) : undefined,
    });
  }

  const sockoptPayload = buildSockoptSettings(values);
  if (sockoptPayload) {
    stream.sockopt = sockoptPayload;
  }

  return cleanObject(stream);
};

const buildSettings = (values: InboundFormValues): Record<string, any> => {
  const base: Record<string, any> = { clients: [] };

  switch (values.protocol) {
    case "vmess":
      base.disableInsecureEncryption = values.disableInsecureEncryption;
      break;
    case "vless":
      base.decryption = values.vlessDecryption || "none";
      if (values.vlessEncryption) {
        base.encryption = values.vlessEncryption;
      }
      if (values.vlessSelectedAuth) {
        base.selectedAuth = values.vlessSelectedAuth;
      }
      if (values.fallbacks.length) {
        base.fallbacks = values.fallbacks
          .map(formToFallback)
          .filter((fallback) => Object.keys(fallback).length);
      }
      break;
    case "trojan":
      if (values.fallbacks.length) {
        base.fallbacks = values.fallbacks
          .map(formToFallback)
          .filter((fallback) => Object.keys(fallback).length);
      }
      break;
    case "shadowsocks":
      base.network = values.shadowsocksNetwork || "tcp,udp";
      break;
  }

  return base;
};

export const buildInboundPayload = (values: InboundFormValues): RawInbound => {
  const payload: RawInbound = {
    tag: values.tag.trim(),
    listen: values.listen.trim() || undefined,
    port: parsePort(values.port),
    protocol: values.protocol,
    settings: buildSettings(values),
    streamSettings: buildStreamSettings(values),
  };

  if (values.sniffingEnabled) {
    payload.sniffing = cleanObject({
      enabled: true,
      destOverride: values.sniffingDestinations,
      routeOnly: values.sniffingRouteOnly,
      metadataOnly: values.sniffingMetadataOnly,
    });
  }

  return payload;
};
