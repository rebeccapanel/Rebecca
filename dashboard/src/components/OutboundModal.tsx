import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  VStack,
  chakra,
  useColorModeValue,
  useToast,
} from "@chakra-ui/react";
import { PlusIcon, MinusIcon as MinusIconOutline } from "@heroicons/react/24/outline";
import {
  Outbound,
  Protocols,
  StreamSettings,
  TcpStreamSettings,
  WsStreamSettings,
  GrpcStreamSettings,
  TlsStreamSettings,
  RealityStreamSettings,
  SSMethods,
} from "../utils/outbound";
import { JsonEditor } from "./JsonEditor";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

const AddIcon = chakra(PlusIcon);
const MinusIcon = chakra(MinusIconOutline);

type ProtocolValue = (typeof Protocols)[keyof typeof Protocols];

interface WireguardPeerForm {
  publicKey: string;
  allowedIPs: string;
  endpoint: string;
  keepAlive: number;
}

interface OutboundFormValues {
  tag: string;
  protocol: string;
  sendThrough: string;
  address: string;
  port: number;
  id: string;
  encryption: string;
  flow: string;
  password: string;
  user: string;
  pass: string;
  method: string;
  tlsEnabled: boolean;
  tlsServerName: string;
  realityEnabled: boolean;
  realityPublicKey: string;
  realityShortId: string;
  network: "tcp" | "ws" | "grpc";
  tcpType: "none" | "http";
  tcpHost: string;
  tcpPath: string;
  wsHost: string;
  wsPath: string;
  grpcServiceName: string;
  muxEnabled: boolean;
  muxConcurrency: number;
  vnextEncryption: string;
  dnsNetwork: string;
  dnsAddress: string;
  dnsPort: number;
  freedomStrategy: string;
  blackholeResponse: string;
  wireguardSecret: string;
  wireguardAddress: string;
  wireguardPeers: WireguardPeerForm[];
}

interface OutboundModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialOutbound?: any | null;
  onSubmitOutbound: (outboundJson: any) => Promise<void> | void;
}

const defaultValues: OutboundFormValues = {
  tag: "",
  protocol: Protocols.VLESS,
  sendThrough: "",
  address: "",
  port: 443,
  id: "",
  encryption: "none",
  flow: "",
  password: "",
  user: "",
  pass: "",
  method: SSMethods.AES_128_GCM,
  tlsEnabled: false,
  tlsServerName: "",
  realityEnabled: false,
  realityPublicKey: "",
  realityShortId: "",
  network: "tcp",
  tcpType: "none",
  tcpHost: "",
  tcpPath: "",
  wsHost: "",
  wsPath: "",
  grpcServiceName: "",
  muxEnabled: false,
  muxConcurrency: 8,
  vnextEncryption: "auto",
  dnsNetwork: "udp",
  dnsAddress: "",
  dnsPort: 53,
  freedomStrategy: "",
  blackholeResponse: "",
  wireguardSecret: "",
  wireguardAddress: "",
  wireguardPeers: [
    {
      publicKey: "",
      allowedIPs: "0.0.0.0/0,::/0",
      endpoint: "",
      keepAlive: 0,
    },
  ],
};

const buildOutboundJson = (values: OutboundFormValues) => {
  const settings: any = {};
  const baseAddress = values.address || undefined;
  const basePort = Number(values.port) || undefined;

  switch (values.protocol) {
    case Protocols.VMess:
      settings.vnext = [
        {
          address: baseAddress,
          port: basePort,
          users: [
            {
              id: values.id || undefined,
              security: values.vnextEncryption || undefined,
            },
          ],
        },
      ];
      break;
    case Protocols.VLESS:
      settings.vnext = [
        {
          address: baseAddress,
          port: basePort,
          users: [
            {
              id: values.id || undefined,
              encryption: values.encryption || undefined,
              flow: values.flow || undefined,
            },
          ],
        },
      ];
      break;
    case Protocols.Trojan:
      settings.servers = [
        {
          address: baseAddress,
          port: basePort,
          password: values.password || undefined,
        },
      ];
      break;
    case Protocols.Shadowsocks:
      settings.servers = [
        {
          address: baseAddress,
          port: basePort,
          password: values.password || undefined,
          method: values.method || undefined,
        },
      ];
      break;
    case Protocols.Socks:
    case Protocols.HTTP:
      settings.servers = [
        {
          address: baseAddress,
          port: basePort,
          users:
            values.user || values.pass
              ? [{ user: values.user || undefined, pass: values.pass || undefined }]
              : [],
        },
      ];
      break;
    case Protocols.Freedom:
      settings.domainStrategy = values.freedomStrategy || undefined;
      break;
    case Protocols.Blackhole:
      settings.response = values.blackholeResponse ? { type: values.blackholeResponse } : undefined;
      break;
    case Protocols.DNS:
      settings.network = values.dnsNetwork;
      settings.address = values.dnsAddress || undefined;
      settings.port = Number(values.dnsPort) || undefined;
      break;
    case Protocols.Wireguard:
      settings.secretKey = values.wireguardSecret || undefined;
      settings.address = values.wireguardAddress
        ? values.wireguardAddress.split(",").map((item) => item.trim()).filter(Boolean)
        : undefined;
      settings.peers = values.wireguardPeers.map((peer: WireguardPeerForm) => ({
        publicKey: peer.publicKey || undefined,
        allowedIPs: peer.allowedIPs
          ? peer.allowedIPs.split(",").map((item) => item.trim()).filter(Boolean)
          : undefined,
        endpoint: peer.endpoint || undefined,
        keepAlive: Number(peer.keepAlive) || undefined,
      }));
      break;
    default:
      break;
  }

  const streamSettings = new StreamSettings();
  streamSettings.network = values.network;
  streamSettings.security = values.tlsEnabled ? "tls" : values.realityEnabled ? "reality" : "none";

  if (values.network === "tcp") {
    streamSettings.tcp = new TcpStreamSettings(values.tcpType, values.tcpHost, values.tcpPath);
  } else if (values.network === "ws") {
    streamSettings.ws = new WsStreamSettings(values.wsPath, values.wsHost, 0);
  } else if (values.network === "grpc") {
    streamSettings.grpc = new GrpcStreamSettings(values.grpcServiceName, "", false);
  }

  if (values.tlsEnabled) {
    streamSettings.tls = new TlsStreamSettings(values.tlsServerName, [], "", false, "");
  }

  if (values.realityEnabled) {
    streamSettings.reality = new RealityStreamSettings(
      values.realityPublicKey,
      "",
      values.tlsServerName,
      values.realityShortId,
      "",
      ""
    );
  }

  const outbound = new Outbound(values.tag, values.protocol, settings, streamSettings, undefined);
  const json = outbound.toJson();
  json.sendThrough = values.sendThrough || undefined;
  if (values.muxEnabled) {
    json.mux = {
      enabled: true,
      concurrency: Number(values.muxConcurrency) || undefined,
    };
  }
  return json;
};

export const OutboundModal: FC<OutboundModalProps> = ({
  isOpen,
  onClose,
  mode,
  initialOutbound,
  onSubmitOutbound,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const bgSubtle = useColorModeValue("gray.50", "whiteAlpha.100");
  const {
    control,
    register,
    reset,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { isValid },
  } = useForm<OutboundFormValues>({
    defaultValues,
    mode: "onChange",
    reValidateMode: "onChange",
    criteriaMode: "all",
  });
  useEffect(() => {
    register("tlsEnabled");
    register("realityEnabled");
  }, [register]);

  const { fields, append, remove } = useFieldArray({ control, name: "wireguardPeers" });
  const protocol = watch("protocol");
  const network = watch("network");
  const tlsEnabled = watch("tlsEnabled");
  const realityEnabled = watch("realityEnabled");
  const tcpType = watch("tcpType");

  const muxEnabled = watch("muxEnabled");
  const requiredMessage = t("validation.required");
  const invalidPortMessage = t("validation.invalidPort");
  const typedProtocol = (protocol as ProtocolValue) || Protocols.VLESS;
  const requiresEndpoint = !([Protocols.Freedom, Protocols.Blackhole, Protocols.DNS, Protocols.Wireguard] as ProtocolValue[]).includes(
    typedProtocol
  );
  const requiresId = ([Protocols.VMess, Protocols.VLESS] as ProtocolValue[]).includes(typedProtocol);
  const requiresPassword = ([Protocols.Trojan, Protocols.Shadowsocks] as ProtocolValue[]).includes(typedProtocol);
  const requiresMethod = typedProtocol === Protocols.Shadowsocks;
  const requiresDnsServer = typedProtocol === Protocols.DNS;
  const formValues = useWatch({ control }) as OutboundFormValues;
  const [activeTab, setActiveTab] = useState(0);
  const [jsonData, setJsonData] = useState(() => buildOutboundJson(defaultValues));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(buildOutboundJson(defaultValues), null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [configInput, setConfigInput] = useState("");
  const updatingFromJsonRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActiveTab(0);
    setJsonError(null);
    setConfigInput("");
    const baseValues = initialOutbound ? mapJsonToFormValues(initialOutbound) : defaultValues;
    updatingFromJsonRef.current = true;
    reset(baseValues);
    const freshJson = buildOutboundJson(baseValues);
    setJsonData(freshJson);
    setJsonText(JSON.stringify(freshJson, null, 2));
  }, [initialOutbound, isOpen, reset]);

  useEffect(() => {
    if (!formValues) return;
    if (updatingFromJsonRef.current) {
      updatingFromJsonRef.current = false;
      return;
    }
    const updatedJson = buildOutboundJson(formValues);
    setJsonData(updatedJson);
    const formatted = JSON.stringify(updatedJson, null, 2);
    setJsonText((prev) => (prev === formatted ? prev : formatted));
    setJsonError(null);
  }, [formValues]);

  const protocolOptions = useMemo(
    () => [
      Protocols.VLESS,
      Protocols.VMess,
      Protocols.Trojan,
      Protocols.Shadowsocks,
      Protocols.Socks,
      Protocols.HTTP,
      Protocols.Freedom,
      Protocols.Blackhole,
      Protocols.DNS,
      Protocols.Wireguard,
    ],
    []
  );

  const mapJsonToFormValues = (json: any): OutboundFormValues => {
    const outbound = Outbound.fromJson(json);
    const mapped: OutboundFormValues = {
      ...defaultValues,
      tag: json?.tag ?? "",
      protocol: ((outbound?.protocol as ProtocolValue) || defaultValues.protocol) as ProtocolValue,
      sendThrough: json?.sendThrough ?? "",
      muxEnabled: Boolean(json?.mux?.enabled),
      muxConcurrency: Number(json?.mux?.concurrency ?? defaultValues.muxConcurrency),
    };

    const stream = outbound?.stream;
    mapped.network = (stream?.network as OutboundFormValues["network"]) ?? defaultValues.network;
    mapped.tlsEnabled = stream?.security === "tls";
    mapped.realityEnabled = stream?.security === "reality";
    mapped.tlsServerName = stream?.tls?.serverName ?? "";
    mapped.realityPublicKey = stream?.reality?.publicKey ?? "";
    mapped.realityShortId = stream?.reality?.shortId ?? "";

    if (stream?.network === "tcp" && stream.tcp) {
      mapped.tcpType = stream.tcp.type as OutboundFormValues["tcpType"];
      mapped.tcpHost = stream.tcp.host ?? "";
      mapped.tcpPath = stream.tcp.path ?? "";
    }
    if (stream?.network === "ws" && stream.ws) {
      mapped.wsHost = stream.ws.host ?? "";
      mapped.wsPath = stream.ws.path ?? "";
    }
    if (stream?.network === "grpc" && stream.grpc) {
      mapped.grpcServiceName = stream.grpc.serviceName ?? "";
    }

    if (outbound?.hasAddressPort()) {
      mapped.address = outbound.settings?.address ?? json?.settings?.address ?? "";
      mapped.port = Number(outbound.settings?.port ?? json?.settings?.port ?? defaultValues.port);
    }

    switch (mapped.protocol) {
      case Protocols.VMess: {
        const settings = outbound.settings as Outbound.VmessSettings;
        mapped.id = settings?.id ?? "";
        mapped.vnextEncryption = settings?.security ?? defaultValues.vnextEncryption;
        mapped.address = settings?.address ?? mapped.address;
        mapped.port = Number(settings?.port ?? mapped.port);
        break;
      }
      case Protocols.VLESS: {
        const settings = outbound.settings as Outbound.VLESSSettings;
        mapped.id = settings?.id ?? "";
        mapped.flow = settings?.flow ?? "";
        mapped.encryption = settings?.encryption ?? mapped.encryption;
        mapped.address = settings?.address ?? mapped.address;
        mapped.port = Number(settings?.port ?? mapped.port);
        break;
      }
      case Protocols.Trojan: {
        const settings = outbound.settings as Outbound.TrojanSettings;
        mapped.password = settings?.password ?? "";
        mapped.address = settings?.address ?? mapped.address;
        mapped.port = Number(settings?.port ?? mapped.port);
        break;
      }
      case Protocols.Shadowsocks: {
        const settings = outbound.settings as Outbound.ShadowsocksSettings;
        mapped.password = settings?.password ?? "";
        mapped.method = settings?.method ?? defaultValues.method;
        mapped.address = settings?.address ?? mapped.address;
        mapped.port = Number(settings?.port ?? mapped.port);
        break;
      }
      case Protocols.Socks:
      case Protocols.HTTP: {
        const settings =
          mapped.protocol === Protocols.Socks
            ? (outbound.settings as Outbound.SocksSettings)
            : (outbound.settings as Outbound.HttpSettings);
        mapped.user = settings?.user ?? "";
        mapped.pass = settings?.pass ?? "";
        mapped.address = settings?.address ?? mapped.address;
        mapped.port = Number(settings?.port ?? mapped.port);
        break;
      }
      case Protocols.DNS: {
        const settings = outbound.settings as Outbound.DNSSettings;
        mapped.dnsNetwork = settings?.network ?? defaultValues.dnsNetwork;
        mapped.dnsAddress = settings?.address ?? "";
        mapped.dnsPort = Number(settings?.port ?? defaultValues.dnsPort);
        break;
      }
      case Protocols.Freedom: {
        const settings = outbound.settings as Outbound.FreedomSettings;
        mapped.freedomStrategy = settings?.domainStrategy ?? "";
        break;
      }
      case Protocols.Blackhole: {
        const settings = outbound.settings as Outbound.BlackholeSettings;
        mapped.blackholeResponse = settings?.type ?? "";
        break;
      }
      case Protocols.Wireguard: {
        const settings = outbound.settings as Outbound.WireguardSettings;
        mapped.wireguardSecret = settings?.secretKey ?? "";
        mapped.wireguardAddress = settings?.address ?? "";
        const peers =
          settings?.peers?.map((peer: Outbound.WireguardPeer) => ({
            publicKey: peer.publicKey ?? "",
            allowedIPs: Array.isArray(peer.allowedIPs) ? peer.allowedIPs.join(",") : "",
            endpoint: peer.endpoint ?? "",
            keepAlive: Number(peer.keepAlive ?? 0),
          })) ?? [];
        mapped.wireguardPeers = peers.length > 0 ? peers : defaultValues.wireguardPeers;
        break;
      }
      default:
        break;
    }

    if (json?.mux?.concurrency != null) {
      mapped.muxConcurrency = Number(json.mux.concurrency);
    }

    if (!mapped.wireguardPeers || mapped.wireguardPeers.length === 0) {
      mapped.wireguardPeers = defaultValues.wireguardPeers;
    }

    return mapped;
  };

  const handleJsonEditorChange = (value: string) => {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      setJsonError(null);
      setJsonData(parsed);
      updatingFromJsonRef.current = true;
      const mapped = mapJsonToFormValues(parsed);
      reset(mapped);
    } catch (error: any) {
      setJsonError(error.message);
    }
  };

  const handleConfigToJson = () => {
    const trimmed = configInput.trim();
    if (!trimmed) {
      setJsonError(t("pages.outbound.configEmpty", "Please paste a config link"));
      return;
    }
    const outboundFromLink = Outbound.fromLink(trimmed);
    if (!outboundFromLink) {
      setJsonError(t("pages.outbound.invalidConfig", "Unsupported or invalid config link"));
      toast({
        status: "error",
        duration: 2500,
        position: "top",
        title: t("pages.outbound.configParseFailedTitle", "Conversion failed"),
        description: t("pages.outbound.configParseFailedDesc", "Could not parse the provided config link."),
      });
      return;
    }
    const json = outboundFromLink.toJson();
    const formatted = JSON.stringify(json, null, 2);
    setConfigInput("");
    handleJsonEditorChange(formatted);
    toast({
      status: "success",
      duration: 2000,
      position: "top",
      title: t("pages.outbound.configConvertedTitle", "Config converted"),
      description: t("pages.outbound.configConvertedDesc", "Configuration applied to the form."),
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const outboundJson = buildOutboundJson(values);
    try {
      await onSubmitOutbound(outboundJson);
      toast({
        title:
          mode === "edit"
            ? t("pages.xray.outbound.updated", "Outbound updated")
            : t("pages.xray.outbound.addOutbound"),
        status: "success",
        duration: 2000,
        position: "top",
      });
      onClose();
    } catch (error: any) {
      toast({
        title:
          error?.data?.detail ||
          error?.message ||
          t("pages.xray.outbound.saveFailed", "Unable to save outbound"),
        status: "error",
        duration: 3000,
        position: "top",
      });
    }
  });

  const handleClose = () => {
    onClose();
  };

  const handleTabChange = (index: number) => {
    setActiveTab(index);
    if (index === 1) {
      const currentJson = buildOutboundJson(getValues());
      setJsonData(currentJson);
      const formatted = JSON.stringify(currentJson, null, 2);
      setJsonText((prev) => (prev === formatted ? prev : formatted));
      setJsonError(null);
    }
  };

  return (
    <Modal size="4xl" isOpen={isOpen} onClose={handleClose} scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
      <ModalContent as="form" onSubmit={onSubmit}>
        <ModalHeader>
          {mode === "edit"
            ? t("pages.xray.outbound.editOutbound", "Edit Outbound")
            : t("pages.xray.outbound.addOutbound")}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Tabs variant="enclosed" colorScheme="primary" index={activeTab} onChange={handleTabChange}>
            <TabList>
              <Tab>{t("form")}</Tab>
              <Tab>{t("json")}</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <VStack spacing={6} align="stretch">
                  <Box>
                    <Text fontWeight="semibold" mb={3}>
                      {t("pages.outbound.basicSettings", "Basic settings")}
                    </Text>
                    <VStack spacing={3} align="stretch">
                      <FormControl isRequired>
                        <FormLabel>{t("pages.xray.outbound.tag")}</FormLabel>
                        <Input size="sm" placeholder="outbound-tag" {...register("tag", { required: requiredMessage })} />
                      </FormControl>
                      <HStack>
                        <FormControl isRequired>
                          <FormLabel>{t("protocol")}</FormLabel>
                          <Select size="sm" {...register("protocol")}>
                            {protocolOptions.map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </Select>
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("pages.xray.outbound.sendThrough")}</FormLabel>
                          <Input size="sm" placeholder="0.0.0.0" {...register("sendThrough")} />
                        </FormControl>
                      </HStack>
                    </VStack>
                  </Box>

                  {requiresEndpoint && (
                    <Box>
                      <Text fontWeight="semibold" mb={3}>
                        {t("pages.outbound.endpoint", "Endpoint")}
                      </Text>
                      <VStack spacing={3} align="stretch">
                        <FormControl isRequired={requiresEndpoint}>
                          <FormLabel>{t("pages.outbound.address", "Address")}</FormLabel>
                          <Input
                            size="sm"
                            placeholder="example.com"
                            {...register("address", { required: requiresEndpoint ? requiredMessage : false })}
                          />
                        </FormControl>
                        <HStack>
                          <FormControl isRequired={requiresEndpoint}>
                            <FormLabel>{t("pages.outbound.port", "Port")}</FormLabel>
                            <Input
                              size="sm"
                              type="number"
                              min={1}
                              max={65535}
                              {...register("port", {
                                required: requiresEndpoint ? requiredMessage : false,
                                valueAsNumber: true,
                                min: { value: 1, message: invalidPortMessage },
                                max: { value: 65535, message: invalidPortMessage },
                              })}
                            />
                          </FormControl>
                          {requiresId ? (
                            <FormControl isRequired={requiresId}>
                              <FormLabel>ID</FormLabel>
                              <Input
                                size="sm"
                                placeholder="UUID"
                                {...register("id", { required: requiresId ? requiredMessage : false })}
                              />
                            </FormControl>
                          ) : requiresPassword ? (
                            <FormControl isRequired={requiresPassword}>
                              <FormLabel>{t("password")}</FormLabel>
                              <Input
                                size="sm"
                                placeholder="password"
                                {...register("password", { required: requiresPassword ? requiredMessage : false })}
                              />
                            </FormControl>
                          ) : (
                            <FormControl>
                              <FormLabel>{t("username")}</FormLabel>
                              <Input size="sm" placeholder="username" {...register("user")} />
                            </FormControl>
                          )}
                        </HStack>
                        {typedProtocol === Protocols.Shadowsocks && (
                          <FormControl isRequired={requiresMethod}>
                            <FormLabel>{t("pages.outbound.method", "Method")}</FormLabel>
                            <Select size="sm" {...register("method", { required: requiresMethod ? requiredMessage : false })}>
                              {Object.values(SSMethods).map((method) => (
                                <option key={method} value={method}>
                                  {method}
                                </option>
                              ))}
                            </Select>
                          </FormControl>
                        )}
                        {typedProtocol === Protocols.VLESS && (
                          <HStack>
                            <FormControl>
                              <FormLabel>{t("pages.outbound.encryption", "Encryption")}</FormLabel>
                              <Input size="sm" placeholder="none" {...register("encryption")} />
                            </FormControl>
                            <FormControl>
                              <FormLabel>Flow</FormLabel>
                              <Input size="sm" placeholder="xtls-rprx-vision" {...register("flow")} />
                            </FormControl>
                          </HStack>
                        )}
                        {typedProtocol === Protocols.VMess && (
                          <FormControl>
                            <FormLabel>{t("pages.outbound.security", "User security")}</FormLabel>
                            <Input size="sm" placeholder="auto" {...register("vnextEncryption")} />
                          </FormControl>
                        )}
                      </VStack>
                    </Box>
                  )}

                  {typedProtocol === Protocols.DNS && (
                    <Box>
                      <Text fontWeight="semibold" mb={3}>
                        {t("pages.outbound.dnsSettings", "DNS settings")}
                      </Text>
                      <HStack>
                        <FormControl>
                          <FormLabel>{t("pages.outbound.network")}</FormLabel>
                          <Select size="sm" {...register("dnsNetwork")}>
                            <option value="udp">udp</option>
                            <option value="tcp">tcp</option>
                          </Select>
                        </FormControl>
                        <FormControl isRequired={requiresDnsServer}>
                          <FormLabel>{t("pages.outbound.port")}</FormLabel>
                          <Input
                            size="sm"
                            type="number"
                            min={1}
                            max={65535}
                            {...register("dnsPort", {
                              required: requiresDnsServer ? requiredMessage : false,
                              valueAsNumber: true,
                              min: { value: 1, message: invalidPortMessage },
                              max: { value: 65535, message: invalidPortMessage },
                            })}
                          />
                        </FormControl>
                      </HStack>
                      <FormControl mt={3} isRequired={requiresDnsServer}>
                        <FormLabel>{t("pages.outbound.address")}</FormLabel>
                        <Input
                          size="sm"
                          placeholder="8.8.8.8"
                          {...register("dnsAddress", { required: requiresDnsServer ? requiredMessage : false })}
                        />
                      </FormControl>
                    </Box>
                  )}

                  {typedProtocol === Protocols.Freedom && (
                    <Box>
                      <Text fontWeight="semibold" mb={3}>
                        {t("pages.outbound.freedom", "Freedom options")}
                      </Text>
                      <FormControl>
                        <FormLabel>{t("pages.outbound.strategy", "Strategy")}</FormLabel>
                        <Input size="sm" placeholder="UseIP" {...register("freedomStrategy")} />
                      </FormControl>
                    </Box>
                  )}

                  {typedProtocol === Protocols.Blackhole && (
                    <Box>
                      <Text fontWeight="semibold" mb={3}>
                        {t("pages.outbound.blackhole", "Blackhole options")}
                      </Text>
                      <FormControl>
                        <FormLabel>{t("pages.outbound.response")}</FormLabel>
                        <Input size="sm" placeholder="none" {...register("blackholeResponse")} />
                      </FormControl>
                    </Box>
                  )}

                  {typedProtocol === Protocols.Wireguard && (
                    <Box>
                      <Text fontWeight="semibold" mb={3}>
                        {t("pages.outbound.wireguard", "Wireguard")}
                      </Text>
                      <VStack spacing={3} align="stretch">
                        <FormControl>
                          <FormLabel>{t("pages.outbound.secretKey", "Secret key")}</FormLabel>
                          <Input size="sm" {...register("wireguardSecret")} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("pages.outbound.address")}</FormLabel>
                          <Input size="sm" placeholder="10.0.0.1/32" {...register("wireguardAddress")} />
                        </FormControl>
                        <VStack spacing={3} align="stretch">
                          <HStack justify="space-between">
                            <Text fontWeight="semibold">{t("pages.outbound.peer", "Peers")}</Text>
                            <IconButton
                              size="sm"
                              aria-label={t("add")}
                              icon={<AddIcon boxSize={3} />}
                              onClick={() =>
                                append({
                                  publicKey: "",
                                  allowedIPs: "0.0.0.0/0,::/0",
                                  endpoint: "",
                                  keepAlive: 0,
                                })
                              }
                            />
                          </HStack>
                          {fields.map((field, index) => (
                            <Box key={field.id} borderWidth="1px" borderRadius="md" p={3} bg={bgSubtle}>
                              <HStack>
                                <FormControl>
                                  <FormLabel>{t("pages.outbound.publicKey", "Public key")}</FormLabel>
                                  <Input size="sm" {...register(`wireguardPeers.${index}.publicKey` as const)} />
                                </FormControl>
                                {fields.length > 1 && (
                                  <IconButton
                                    mt={6}
                                    size="sm"
                                    aria-label={t("delete")}
                                    icon={<MinusIcon boxSize={3} />}
                                    onClick={() => remove(index)}
                                  />
                                )}
                              </HStack>
                              <HStack mt={2}>
                                <FormControl>
                                  <FormLabel>{t("pages.outbound.allowedIPs", "Allowed IPs")}</FormLabel>
                                  <Input size="sm" {...register(`wireguardPeers.${index}.allowedIPs` as const)} />
                                </FormControl>
                                <FormControl>
                                  <FormLabel>{t("pages.outbound.endpoint", "Endpoint")}</FormLabel>
                                  <Input size="sm" {...register(`wireguardPeers.${index}.endpoint` as const)} />
                                </FormControl>
                              </HStack>
                              <FormControl mt={2}>
                                <FormLabel>{t("pages.outbound.keepAlive", "Keep alive")}</FormLabel>
                                <Input
                                  size="sm"
                                  type="number"
                                  {...register(`wireguardPeers.${index}.keepAlive` as const, { valueAsNumber: true })}
                                />
                              </FormControl>
                            </Box>
                          ))}
                        </VStack>
                      </VStack>
                    </Box>
                  )}

                  <Box>
                    <Text fontWeight="semibold" mb={3}>
                      {t("pages.outbound.transport", "Transport")}
                    </Text>
                    <VStack spacing={3} align="stretch">
                      <FormControl>
                        <FormLabel>{t("pages.outbound.network")}</FormLabel>
                        <Select size="sm" {...register("network")}
                          onChange={(event) => {
                            register("network").onChange(event);
                          }}
                        >
                          <option value="tcp">tcp</option>
                          <option value="ws">ws</option>
                          <option value="grpc">grpc</option>
                        </Select>
                      </FormControl>
                      {network === "tcp" && (
                        <HStack>
                          <FormControl>
                            <FormLabel>{t("pages.outbound.tcpHeader", "Header")}</FormLabel>
                            <Select size="sm" {...register("tcpType")}>
                              <option value="none">none</option>
                              <option value="http">http</option>
                            </Select>
                          </FormControl>
                          {tcpType === "http" && (
                            <>
                              <FormControl>
                                <FormLabel>{t("host")}</FormLabel>
                                <Input size="sm" {...register("tcpHost")} />
                              </FormControl>
                              <FormControl>
                                <FormLabel>{t("path")}</FormLabel>
                                <Input size="sm" {...register("tcpPath")} />
                              </FormControl>
                            </>
                          )}
                        </HStack>
                      )}
                      {network === "ws" && (
                        <HStack>
                          <FormControl>
                            <FormLabel>{t("host")}</FormLabel>
                            <Input size="sm" {...register("wsHost")} />
                          </FormControl>
                          <FormControl>
                            <FormLabel>{t("path")}</FormLabel>
                            <Input size="sm" {...register("wsPath")} />
                          </FormControl>
                        </HStack>
                      )}
                      {network === "grpc" && (
                        <FormControl>
                          <FormLabel>{t("serviceName")}</FormLabel>
                          <Input size="sm" {...register("grpcServiceName")} />
                        </FormControl>
                      )}
                    </VStack>
                  </Box>

                  <Box>
                    <Text fontWeight="semibold" mb={3}>
                      {t("pages.outbound.security")}
                    </Text>
                    <HStack>
                      <FormControl display="flex" alignItems="center">
                        <FormLabel mb="0">TLS</FormLabel>
                        <Switch
                          size="sm"
                          isChecked={tlsEnabled}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setValue("tlsEnabled", checked);
                            if (checked) {
                              setValue("realityEnabled", false);
                            }
                          }}
                        />
                      </FormControl>
                      <FormControl display="flex" alignItems="center">
                        <FormLabel mb="0">Reality</FormLabel>
                        <Switch
                          size="sm"
                          isChecked={realityEnabled}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setValue("realityEnabled", checked);
                            if (checked) {
                              setValue("tlsEnabled", false);
                            }
                          }}
                        />
                      </FormControl>
                    </HStack>
                    {tlsEnabled && (
                      <FormControl mt={3}>
                        <FormLabel>SNI</FormLabel>
                        <Input size="sm" placeholder="example.com" {...register("tlsServerName")} />
                      </FormControl>
                    )}
                    {realityEnabled && (
                      <VStack spacing={3} align="stretch" mt={3}>
                        <FormControl>
                          <FormLabel>SNI</FormLabel>
                          <Input size="sm" {...register("tlsServerName")} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("pages.outbound.publicKey")}</FormLabel>
                          <Input size="sm" {...register("realityPublicKey")} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("pages.outbound.shortId")}</FormLabel>
                          <Input size="sm" {...register("realityShortId")} />
                        </FormControl>
                      </VStack>
                    )}
                  </Box>

                  <Box>
                    <Text fontWeight="semibold" mb={3}>
                      {t("pages.outbound.mux")}
                    </Text>
                    <FormControl display="flex" alignItems="center">
                      <FormLabel mb="0">{t("pages.outbound.enableMux")}</FormLabel>
                      <Switch size="sm" {...register("muxEnabled")} />
                    </FormControl>
                    {muxEnabled && (
                      <FormControl mt={3}>
                        <FormLabel>{t("pages.outbound.concurrency")}</FormLabel>
                        <Input size="sm" type="number" {...register("muxConcurrency", { valueAsNumber: true })} />
                      </FormControl>
                    )}
                  </Box>
                </VStack>
              </TabPanel>
              <TabPanel>
                <VStack align="stretch" spacing={3}>
                  <FormControl>
                    <FormLabel>{t("pages.outbound.configToJson", "Config to JSON")}</FormLabel>
                    <HStack align="start" spacing={3}>
                      <Textarea
                        value={configInput}
                        onChange={(e) => setConfigInput(e.target.value)}
                        placeholder={t(
                          "pages.outbound.configPlaceholder",
                          "Paste vmess/vless/trojan/ss link here"
                        )}
                        rows={3}
                        fontFamily="mono"
                        fontSize="sm"
                        spellCheck={false}
                        flex="1"
                      />
                      <Button size="sm" colorScheme="primary" onClick={handleConfigToJson}>
                        {t("pages.outbound.convertConfig", "Convert")}
                      </Button>
                    </HStack>
                  </FormControl>
                  <Box height="420px">
                    <JsonEditor json={jsonData} onChange={handleJsonEditorChange} />
                  </Box>
                  {jsonError && (
                    <Text fontSize="sm" color="red.500">
                      {jsonError}
                    </Text>
                  )}
                </VStack>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="outline" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button colorScheme="primary" type="submit" isDisabled={!isValid}>
            {mode === "edit" ? t("save") : t("add")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

