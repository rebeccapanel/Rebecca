import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  NumberInput,
  NumberInputField,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  VStack,
  useColorModeValue,
  useToast,
} from "@chakra-ui/react";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetch as apiFetch } from "service/http";
import { Outbound, SizeFormatter } from "../utils/outbound";
import { ensureWireguardGlobal, generateWireguardKeypair } from "../utils/wireguard";

type WarpAccount = {
  device_id: string;
  access_token: string;
  license_key?: string | null;
  private_key: string;
  public_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type WarpRemoteConfig = {
  id?: string;
  name?: string;
  model?: string;
  enabled?: boolean;
  account?: {
    account_type?: string;
    role?: string;
    premium_data?: number;
    quota?: number;
    usage?: number;
  };
  config?: {
    client_id?: string;
    interface?: {
      mtu?: number;
      addresses?: {
        v4?: string;
        v6?: string;
      };
    };
    peers?: Array<{
      public_key?: string;
      allowed_ips?: string[];
      allowedIPs?: string[];
      endpoint?:
        | string
        | {
            host?: string;
            port?: number;
          };
      keep_alive?: number;
      keepAlive?: number;
    }>;
  };
};

type OutboundJson = Record<string, any>;

interface WarpModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOutbound?: OutboundJson | null;
  onSave: (outbound: OutboundJson) => void;
  onDelete: () => void;
}

type WarpFormState = {
  tag: string;
  privateKey: string;
  publicKey: string;
  endpoint: string;
  addressV4: string;
  addressV6: string;
  reserved: string;
  mtu: number;
  domainStrategy: string;
  notes: string;
};

const DEFAULT_WARP_FORM: WarpFormState = {
  tag: "warp",
  privateKey: "",
  publicKey: "",
  endpoint: "engage.cloudflareclient.com:2408",
  addressV4: "",
  addressV6: "",
  reserved: "",
  mtu: 1420,
  domainStrategy: "ForceIP",
  notes: "",
};

const parseOutboundToForm = (outbound?: OutboundJson | null): WarpFormState => {
  if (!outbound) {
    return { ...DEFAULT_WARP_FORM };
  }

  const settings = outbound.settings ?? {};
  const peers = Array.isArray(settings.peers) ? settings.peers : [];
  const firstPeer = peers[0] ?? {};
  const addresses = Array.isArray(settings.address) ? settings.address : [];
  const addressV4 =
    addresses.find((entry: string) => typeof entry === "string" && entry.endsWith("/32"))?.replace("/32", "") ?? "";
  const addressV6 =
    addresses.find((entry: string) => typeof entry === "string" && entry.endsWith("/128"))?.replace("/128", "") ?? "";
  const reserved = Array.isArray(settings.reserved)
    ? settings.reserved.filter((item: unknown) => Number.isFinite(Number(item))).join(",")
    : "";

  return {
    tag: outbound.tag ?? "warp",
    privateKey: settings.secretKey ?? settings.privateKey ?? "",
    publicKey: firstPeer.publicKey ?? "",
    endpoint: typeof firstPeer.endpoint === "string" ? firstPeer.endpoint : "engage.cloudflareclient.com:2408",
    addressV4,
    addressV6,
    reserved,
    mtu: settings.mtu ?? 1420,
    domainStrategy: settings.domainStrategy ?? "ForceIP",
    notes: typeof outbound.notes === "string" ? outbound.notes : settings.notes ?? "",
  };
};

const buildOutboundFromForm = (form: WarpFormState): OutboundJson => {
  const addresses: string[] = [];
  if (form.addressV4.trim()) {
    addresses.push(`${form.addressV4.trim()}/32`);
  }
  if (form.addressV6.trim()) {
    addresses.push(`${form.addressV6.trim()}/128`);
  }
  const reserved = form.reserved
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isFinite(value));

  const outbound = Outbound.fromJson({
    tag: form.tag.trim() || "warp",
    protocol: "wireguard",
    settings: {
      mtu: form.mtu || 1420,
      secretKey: form.privateKey.trim(),
      address: addresses,
      reserved,
      domainStrategy: form.domainStrategy || "ForceIP",
      noKernelTun: false,
      peers: [
        {
          publicKey: form.publicKey.trim(),
          endpoint: form.endpoint.trim(),
        },
      ],
    },
  });
  const json = outbound.toJson();
  if (form.notes.trim()) {
    json.notes = form.notes.trim();
  } else {
    delete json.notes;
  }
  return json;
};

const decodeReservedFromClientId = (clientId?: string): number[] => {
  if (!clientId) return [];
  try {
    const decoded = atob(clientId);
    return Array.from(decoded).map((char) => char.charCodeAt(0));
  } catch {
    return [];
  }
};

const normalizePeerEndpoint = (endpoint?: unknown): string => {
  if (!endpoint) return "";
  if (typeof endpoint === "string") return endpoint;
  if (typeof endpoint === "object" && endpoint !== null) {
    const ref = endpoint as { host?: string; port?: number };
    if (!ref.host) return "";
    return ref.port ? `${ref.host}:${ref.port}` : ref.host;
  }
  return "";
};

const buildOutboundFromWarpRemote = (account: WarpAccount, remote: WarpRemoteConfig | null): Outbound | null => {
  if (!account || !remote?.config) return null;
  const config = remote.config;
  const addresses: string[] = [];
  const addr = config.interface?.addresses ?? {};
  if (addr.v4) addresses.push(`${addr.v4}/32`);
  if (addr.v6) addresses.push(`${addr.v6}/128`);

  const peers = Array.isArray(config.peers) ? config.peers : [];
  const firstPeer = peers[0] ?? {};
  const allowedIPs = firstPeer.allowed_ips ?? firstPeer.allowedIPs ?? ["0.0.0.0/0", "::/0"];

  const outbound = Outbound.fromJson({
    tag: "warp",
    protocol: "wireguard",
    settings: {
      mtu: config.interface?.mtu ?? 1420,
      secretKey: account.private_key,
      address: addresses,
      reserved: decodeReservedFromClientId(config.client_id),
      domainStrategy: "ForceIP",
      noKernelTun: false,
      peers: [
        {
          publicKey: firstPeer.public_key ?? account.public_key ?? "",
          endpoint: normalizePeerEndpoint(firstPeer.endpoint),
          allowedIPs,
          keepAlive: firstPeer.keep_alive ?? firstPeer.keepAlive ?? 0,
        },
      ],
    },
  });

  return outbound;
};

const formatDate = (value?: string | null): string => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const formatBytes = (value?: number): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return "-";
  }
  return SizeFormatter.sizeFormat(value);
};

const InfoItem: FC<{ label: string; value: string }> = ({ label, value }) => {
  const muted = useColorModeValue("gray.500", "gray.400");
  return (
    <Box>
      <Text fontSize="xs" textTransform="uppercase" color={muted} letterSpacing="wide">
        {label}
      </Text>
      <Text fontWeight="semibold" fontFamily="mono" overflowWrap="anywhere">
        {value || "-"}
      </Text>
    </Box>
  );
};

export const WarpModal: FC<WarpModalProps> = ({ isOpen, onClose, initialOutbound, onSave, onDelete }) => {
  const { t } = useTranslation();
  const toast = useToast();

  const [form, setForm] = useState<WarpFormState>({ ...DEFAULT_WARP_FORM });
  const [warpAccount, setWarpAccount] = useState<WarpAccount | null>(null);
  const [warpRemote, setWarpRemote] = useState<WarpRemoteConfig | null>(null);
  const [warpOutboundCandidate, setWarpOutboundCandidate] = useState<Outbound | null>(null);
  const [licenseInput, setLicenseInput] = useState("");

  const [isAccountLoading, setIsAccountLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isUpdatingLicense, setIsUpdatingLicense] = useState(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    ensureWireguardGlobal();
  }, []);

  const loadAccount = useCallback(async () => {
    setIsAccountLoading(true);
    try {
      const response = await apiFetch<{ account: WarpAccount | null }>("/core/warp", { method: "GET" });
      setWarpAccount(response.account ?? null);
      setWarpRemote(null);
      setWarpOutboundCandidate(null);
    } catch (error: any) {
      toast({
        title: t("pages.xray.warp.loadFailed", "Failed to load WARP account."),
        description: error?.data?.detail || error?.message,
        status: "error",
        duration: 4000,
        isClosable: true,
        position: "top",
      });
    } finally {
      setIsAccountLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    if (isOpen) {
      loadAccount().catch(() => undefined);
    }
  }, [isOpen, loadAccount]);

  useEffect(() => {
    if (isOpen) {
      setForm(parseOutboundToForm(initialOutbound));
    }
  }, [initialOutbound, isOpen]);

  useEffect(() => {
    setLicenseInput(warpAccount?.license_key ?? "");
  }, [warpAccount]);

  const updateFormField = <K extends keyof WarpFormState>(key: K, value: WarpFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const helperColor = useColorModeValue("gray.600", "gray.300");
  const cardBorder = useColorModeValue("gray.200", "whiteAlpha.200");

  const handleGenerateKeys = () => {
    const keys = generateWireguardKeypair();
    updateFormField("privateKey", keys.privateKey);
    updateFormField("publicKey", keys.publicKey);
    toast({
      title: t("pages.xray.warp.keysGenerated", "WireGuard key pair generated."),
      status: "info",
      duration: 2500,
      isClosable: true,
      position: "top",
    });
  };

  const handleInsertReserved = () => {
    const randomValues = Array.from({ length: 3 }, () => Math.floor(Math.random() * 256));
    updateFormField("reserved", randomValues.join(","));
  };

  const hydrateFromRemote = useCallback(
    (account: WarpAccount | null, remoteConfig: WarpRemoteConfig | null) => {
      if (!account || !remoteConfig) {
        setWarpOutboundCandidate(null);
        return;
      }
      const outbound = buildOutboundFromWarpRemote(account, remoteConfig);
      if (outbound) {
        setWarpOutboundCandidate(outbound);
        setForm(parseOutboundToForm(outbound.toJson()));
      }
    },
    []
  );

  const handleRegister = async () => {
    setIsRegistering(true);
    try {
      const keys = generateWireguardKeypair();
      const response = await apiFetch<{ account: WarpAccount; config: WarpRemoteConfig }>("/core/warp/register", {
        method: "POST",
        body: {
          private_key: keys.privateKey,
          public_key: keys.publicKey,
        },
      });
      setWarpAccount(response.account);
      setWarpRemote(response.config);
      hydrateFromRemote(response.account, response.config);
      toast({
        title: t("pages.xray.warp.registerSuccess", "WARP device registered."),
        status: "success",
        duration: 4000,
        isClosable: true,
        position: "top",
      });
    } catch (error: any) {
      toast({
        title: t("pages.xray.warp.registerFailed", "Failed to register WARP device."),
        description: error?.data?.detail || error?.message,
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top",
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleFetchInfo = async () => {
    if (!warpAccount) {
      toast({
        title: t("pages.xray.warp.accountMissing", "Create a WARP device first."),
        status: "warning",
        duration: 3000,
        isClosable: true,
        position: "top",
      });
      return;
    }
    setIsFetchingInfo(true);
    try {
      const response = await apiFetch<{ config: WarpRemoteConfig }>("/core/warp/config", { method: "GET" });
      setWarpRemote(response.config);
      hydrateFromRemote(warpAccount, response.config);
      toast({
        title: t("pages.xray.warp.infoFetched", "WARP information refreshed."),
        status: "success",
        duration: 3000,
        isClosable: true,
        position: "top",
      });
    } catch (error: any) {
      toast({
        title: t("pages.xray.warp.infoFailed", "Unable to fetch WARP info."),
        description: error?.data?.detail || error?.message,
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top",
      });
    } finally {
      setIsFetchingInfo(false);
    }
  };

  const handleUpdateLicense = async () => {
    if (!licenseInput.trim()) {
      return;
    }
    setIsUpdatingLicense(true);
    try {
      const response = await apiFetch<{ account: WarpAccount }>("/core/warp/license", {
        method: "POST",
        body: { license_key: licenseInput.trim() },
      });
      setWarpAccount(response.account);
      toast({
        title: t("pages.xray.warp.licenseUpdated", "License updated."),
        status: "success",
        duration: 3000,
        isClosable: true,
        position: "top",
      });
    } catch (error: any) {
      toast({
        title: t("pages.xray.warp.licenseFailed", "Failed to update license."),
        description: error?.data?.detail || error?.message,
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top",
      });
    } finally {
      setIsUpdatingLicense(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await apiFetch("/core/warp", { method: "DELETE" });
      setWarpAccount(null);
      setWarpRemote(null);
      setWarpOutboundCandidate(null);
      onDelete();
      toast({
        title: t("pages.xray.warp.accountRemoved", "WARP account removed."),
        status: "success",
        duration: 3000,
        isClosable: true,
        position: "top",
      });
    } catch (error: any) {
      toast({
        title: t("pages.xray.warp.removeFailed", "Failed to remove WARP account."),
        description: error?.data?.detail || error?.message,
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top",
      });
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const applyOutboundCandidate = () => {
    if (!warpOutboundCandidate) {
      return;
    }
    const outboundJson = warpOutboundCandidate.toJson();
    onSave(outboundJson);
    toast({
      title: t("pages.xray.warp.outboundApplied", "WARP outbound updated."),
      status: "success",
      duration: 2500,
      isClosable: true,
      position: "top",
    });
  };

  const handleManualDelete = () => {
    onDelete();
    setForm({ ...DEFAULT_WARP_FORM });
    toast({
      title: t("pages.xray.warp.removeOutbound", "Outbound removed."),
      status: "info",
      duration: 2500,
      isClosable: true,
      position: "top",
    });
  };

  const handleManualSave = () => {
    if (!form.privateKey.trim() || !form.publicKey.trim() || !form.endpoint.trim()) {
      toast({
        title: t("pages.xray.warp.validationMissing", "Private key, public key, and endpoint are required."),
        status: "error",
        isClosable: true,
        duration: 3500,
        position: "top",
      });
      return;
    }
    const outboundJson = buildOutboundFromForm(form);
    onSave(outboundJson);
    onClose();
  };

  const isEditingOutbound = useMemo(() => Boolean(initialOutbound), [initialOutbound]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(8px)" />
      <ModalContent>
        <ModalHeader>{t("pages.xray.warp.manage", "Manage WARP")}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={5} align="stretch">
            <Alert status="info" borderRadius="md">
              <AlertIcon />
              <AlertDescription>
                {t(
                  "pages.xray.warp.manualNote",
                  "Provide the credentials exported from Cloudflare WARP (e.g. via warp-cli). You can generate a WireGuard key pair locally, but you still need reserved bytes and endpoints from the official client."
                )}
              </AlertDescription>
            </Alert>

            <Box borderWidth="1px" borderColor={cardBorder} borderRadius="lg" p={4}>
              {warpAccount ? (
                <VStack spacing={4} align="stretch">
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <InfoItem
                      label={t("pages.xray.warp.accessToken", "Access token")}
                      value={warpAccount.access_token || "-"}
                    />
                    <InfoItem label={t("pages.xray.warp.deviceId", "Device ID")} value={warpAccount.device_id || "-"} />
                    <InfoItem
                      label={t("pages.xray.warp.licenseKey", "License key")}
                      value={warpAccount.license_key || "-"}
                    />
                    <InfoItem
                      label={t("pages.xray.warp.privateKey", "Private key")}
                      value={warpAccount.private_key || "-"}
                    />
                    <InfoItem
                      label={t("pages.xray.warp.registeredAt", "Registered at")}
                      value={formatDate(warpAccount.created_at)}
                    />
                    <InfoItem
                      label={t("pages.xray.warp.updatedAt", "Updated at")}
                      value={formatDate(warpAccount.updated_at)}
                    />
                  </SimpleGrid>
                  <HStack spacing={3} flexWrap="wrap">
                    <Button variant="outline" onClick={handleFetchInfo} isLoading={isFetchingInfo}>
                      {t("pages.xray.warp.fetchInfo", "Refresh info")}
                    </Button>
                    <Button variant="ghost" colorScheme="red" onClick={handleDeleteAccount} isLoading={isDeletingAccount}>
                      {t("pages.xray.warp.removeAccount", "Remove account")}
                    </Button>
                  </HStack>
                </VStack>
              ) : (
                <VStack spacing={3} align="stretch">
                  <Text fontSize="sm" color={helperColor}>
                    {t(
                      "pages.xray.warp.registerDescription",
                      "No Cloudflare WARP device has been registered yet. The dashboard can generate a WireGuard key pair locally and register a new device via Cloudflare's API."
                    )}
                  </Text>
                  <Button colorScheme="primary" onClick={handleRegister} isLoading={isRegistering || isAccountLoading}>
                    {t("pages.xray.warp.registerAction", "Create WARP device")}
                  </Button>
                </VStack>
              )}
            </Box>

            {warpAccount && (
              <Box borderWidth="1px" borderColor={cardBorder} borderRadius="lg" p={4}>
                <Text fontWeight="semibold" mb={2}>
                  {t("pages.xray.warp.licenseSection", "WARP+/License key")}
                </Text>
                <HStack spacing={3} align="stretch" flexWrap="wrap">
                  <Input
                    value={licenseInput}
                    onChange={(event) => setLicenseInput(event.target.value)}
                    placeholder="ABCD-1234..."
                    size="sm"
                  />
                  <Button
                    colorScheme="primary"
                    onClick={handleUpdateLicense}
                    isLoading={isUpdatingLicense}
                    isDisabled={!licenseInput.trim()}
                  >
                    {t("pages.xray.warp.updateLicense", "Update license")}
                  </Button>
                </HStack>
                <Text fontSize="xs" color={helperColor} mt={2}>
                  {t(
                    "pages.xray.warp.licenseHint",
                    "Optional Cloudflare WARP+ license. Leave empty if you only need the free tier."
                  )}
                </Text>
              </Box>
            )}

            <Box borderWidth="1px" borderColor={cardBorder} borderRadius="lg" p={4}>
              <HStack justify="space-between" align="center" mb={2}>
                <Text fontWeight="semibold">{t("pages.xray.warp.remoteConfig", "Remote configuration")}</Text>
                {warpRemote ? (
                  <Badge colorScheme={warpRemote.enabled ? "green" : "yellow"}>
                    {warpRemote.enabled ? t("core.active", "Active") : t("core.pending", "Pending")}
                  </Badge>
                ) : (
                  <Badge colorScheme="gray">{t("core.empty", "Empty")}</Badge>
                )}
              </HStack>
              {warpRemote ? (
                <Stack spacing={4}>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <InfoItem label={t("core.name", "Name")} value={warpRemote.name ?? "-"} />
                    <InfoItem label={t("core.model", "Model")} value={warpRemote.model ?? "-"} />
                    <InfoItem
                      label={t("core.status", "Status")}
                      value={warpRemote.enabled ? t("core.enabled", "Enabled") : t("core.disabled", "Disabled")}
                    />
                    <InfoItem label={t("core.id", "ID")} value={warpRemote.id ?? "-"} />
                  </SimpleGrid>
                  {warpRemote.account && (
                    <>
                      <Divider />
                      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
                        <InfoItem label={t("core.type", "Type")} value={warpRemote.account.account_type ?? "-"} />
                        <InfoItem label={t("core.role", "Role")} value={warpRemote.account.role ?? "-"} />
                        <InfoItem
                          label={t("pages.xray.warp.premiumData", "WARP+ data")}
                          value={formatBytes(warpRemote.account.premium_data)}
                        />
                        <InfoItem label={t("core.quota", "Quota")} value={formatBytes(warpRemote.account.quota)} />
                        <InfoItem label={t("core.usage", "Usage")} value={formatBytes(warpRemote.account.usage)} />
                      </SimpleGrid>
                    </>
                  )}
                  <HStack spacing={3} flexWrap="wrap">
                    <Button colorScheme="primary" onClick={applyOutboundCandidate} isDisabled={!warpOutboundCandidate}>
                      {t("pages.xray.warp.applyGenerated", "Apply generated outbound")}
                    </Button>
                    <Button variant="ghost" onClick={() => setWarpRemote(null)}>
                      {t("core.reset", "Reset")}
                    </Button>
                  </HStack>
                </Stack>
              ) : (
                <Text fontSize="sm" color={helperColor}>
                  {t(
                    "pages.xray.warp.remoteEmpty",
                    "Fetch the remote configuration to generate an outbound automatically."
                  )}
                </Text>
              )}
            </Box>

            <Box borderWidth="1px" borderColor={cardBorder} borderRadius="lg" p={4}>
              <Text fontWeight="semibold" mb={2}>
                {t("pages.xray.warp.manualTitle", "Manual outbound")}
              </Text>
              <Stack spacing={4}>
                <FormControl isRequired>
                  <FormLabel>{t("pages.xray.outbound.tag", "Tag")}</FormLabel>
                  <Input
                    size="sm"
                    value={form.tag}
                    onChange={(event) => updateFormField("tag", event.target.value)}
                    placeholder="warp"
                  />
                </FormControl>

                <FormControl isRequired>
                  <FormLabel>{t("pages.xray.warp.privateKey")}</FormLabel>
                  <Textarea
                    size="sm"
                    value={form.privateKey}
                    onChange={(event) => updateFormField("privateKey", event.target.value)}
                    rows={2}
                  />
                </FormControl>

                <FormControl isRequired>
                  <FormLabel>{t("pages.xray.warp.publicKey")}</FormLabel>
                  <Textarea
                    size="sm"
                    value={form.publicKey}
                    onChange={(event) => updateFormField("publicKey", event.target.value)}
                    rows={2}
                  />
                </FormControl>

                <FormControl>
                  <Button size="sm" colorScheme="primary" onClick={handleGenerateKeys}>
                    {t("pages.xray.warp.generateKeys", "Generate Keys")}
                  </Button>
                  <Text fontSize="xs" color={helperColor} mt={1}>
                    {t("pages.xray.warp.generateKeysHint", "Overrides the current key pair.")}
                  </Text>
                </FormControl>

                <FormControl isRequired>
                  <FormLabel>{t("pages.xray.warp.endpoint")}</FormLabel>
                  <Input
                    size="sm"
                    value={form.endpoint}
                    onChange={(event) => updateFormField("endpoint", event.target.value)}
                    placeholder="engage.cloudflareclient.com:2408"
                  />
                </FormControl>

                <FormControl>
                  <FormLabel>{t("pages.xray.warp.addressV4", "Client IPv4")}</FormLabel>
                  <Input
                    size="sm"
                    value={form.addressV4}
                    onChange={(event) => updateFormField("addressV4", event.target.value)}
                    placeholder="172.16.0.2"
                  />
                  <FormHelperText>
                    {t("pages.xray.warp.addressV4Hint", "Optional /32 address from the WARP profile.")}
                  </FormHelperText>
                </FormControl>

                <FormControl>
                  <FormLabel>{t("pages.xray.warp.addressV6", "Client IPv6")}</FormLabel>
                  <Input
                    size="sm"
                    value={form.addressV6}
                    onChange={(event) => updateFormField("addressV6", event.target.value)}
                    placeholder="2606:4700:****:****::****"
                  />
                </FormControl>

                <FormControl>
                  <FormLabel>{t("pages.xray.warp.reserved")}</FormLabel>
                  <Input
                    size="sm"
                    value={form.reserved}
                    onChange={(event) => updateFormField("reserved", event.target.value)}
                    placeholder="0,0,0"
                  />
                  <FormHelperText>
                    {t(
                      "pages.xray.warp.reservedHint",
                      "Comma separated integers (usually three numbers) derived from the client_id."
                    )}
                  </FormHelperText>
                  <Button size="xs" mt={2} variant="ghost" onClick={handleInsertReserved}>
                    {t("pages.xray.warp.randomReserved", "Insert random reserved bytes")}
                  </Button>
                </FormControl>

                <FormControl>
                  <FormLabel>{t("pages.xray.warp.mtu", "MTU")}</FormLabel>
                  <NumberInput
                    size="sm"
                    min={576}
                    max={1600}
                    value={form.mtu}
                    onChange={(_, value) => updateFormField("mtu", value || 1420)}
                  >
                    <NumberInputField />
                  </NumberInput>
                </FormControl>

                <FormControl>
                  <FormLabel>{t("pages.xray.warp.notes", "Notes (optional)")}</FormLabel>
                  <Textarea
                    size="sm"
                    rows={2}
                    value={form.notes}
                    onChange={(event) => updateFormField("notes", event.target.value)}
                  />
                </FormControl>
              </Stack>
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter display="flex" justifyContent="space-between">
          {isEditingOutbound ? (
            <Button colorScheme="red" variant="outline" onClick={handleManualDelete}>
              {t("delete")}
            </Button>
          ) : (
            <span />
          )}
          <HStack spacing={3}>
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button colorScheme="primary" onClick={handleManualSave}>
              {isEditingOutbound ? t("save") : t("add")}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
