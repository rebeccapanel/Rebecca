import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Box,
  Button,
  ButtonGroup,
  chakra,
  Divider,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  SimpleGrid,
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  Tooltip,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import {
  PlusIcon as AddIcon,
  TrashIcon as DeleteIcon,
  PencilIcon as EditIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { useNodes, useNodesQuery, FetchNodesQueryKey, NodeType } from "contexts/NodesContext";
import { useDashboard } from "contexts/DashboardContext";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { NodeModalStatusBadge } from "../components/NodeModalStatusBadge";
import { NodeFormModal } from "../components/NodeFormModal";
import { DeleteNodeModal } from "../components/DeleteNodeModal";
import { fetch as apiFetch } from "service/http";
import { formatBytes } from "utils/formatByte";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import { GeoUpdateDialog } from "../components/GeoUpdateDialog";

dayjs.extend(utc);

const AddIconStyled = chakra(AddIcon, { baseStyle: { w: 4, h: 4 } });
const DeleteIconStyled = chakra(DeleteIcon, { baseStyle: { w: 4, h: 4 } });
const EditIconStyled = chakra(EditIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowPathIconStyled = chakra(ArrowPathIcon, { baseStyle: { w: 4, h: 4 } });
const SearchIcon = chakra(MagnifyingGlassIcon, { baseStyle: { w: 4, h: 4 } });

interface CoreStatsResponse {
  version: string | null;
  started: string | null;
  logs_websocket?: string;
}

type VersionDialogTarget =
  | { type: "master" }
  | { type: "node"; node: NodeType }
  | { type: "bulk" };

type GeoDialogTarget =
  | { type: "master" }
  | { type: "node"; node: NodeType };

export const NodesPage: FC = () => {
  const { t } = useTranslation();
  const { onEditingNodes } = useDashboard();
  const {
    data: nodes,
    isLoading,
    error,
    refetch: refetchNodes,
    isFetching,
  } = useNodesQuery();
  const { addNode, updateNode, reconnectNode, resetNodeUsage, setDeletingNode } = useNodes();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editingNode, setEditingNode] = useState<NodeType | null>(null);
  const [isAddNodeOpen, setAddNodeOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [versionDialogTarget, setVersionDialogTarget] = useState<VersionDialogTarget | null>(null);
  const [geoDialogTarget, setGeoDialogTarget] = useState<GeoDialogTarget | null>(null);
  const [updatingCoreNodeId, setUpdatingCoreNodeId] = useState<number | null>(null);
  const [updatingGeoNodeId, setUpdatingGeoNodeId] = useState<number | null>(null);
  const [updatingMasterCore, setUpdatingMasterCore] = useState(false);
  const [updatingBulkCore, setUpdatingBulkCore] = useState(false);
  const [updatingMasterGeo, setUpdatingMasterGeo] = useState(false);
  const [togglingNodeId, setTogglingNodeId] = useState<number | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Record<number, boolean>>({});
  const [resettingNodeId, setResettingNodeId] = useState<number | null>(null);
  const [resetCandidate, setResetCandidate] = useState<NodeType | null>(null);
  const { isOpen: isResetConfirmOpen, onOpen: openResetConfirm, onClose: closeResetConfirm } = useDisclosure();
  const cancelResetRef = useRef<HTMLButtonElement | null>(null);

  const {
    data: coreStats,
    isLoading: isCoreLoading,
    refetch: refetchCoreStats,
    error: coreError,
  } = useQuery<CoreStatsResponse>(["core-stats"], () => apiFetch<CoreStatsResponse>("/core"), {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    onEditingNodes(true);
    return () => {
      onEditingNodes(false);
    };
  }, [onEditingNodes]);

  const { isLoading: isAdding, mutate: addNodeMutate } = useMutation(addNode, {
    onSuccess: () => {
      generateSuccessMessage(t("nodes.addNodeSuccess"), toast);
      queryClient.invalidateQueries(FetchNodesQueryKey);
      setAddNodeOpen(false);
    },
    onError: (err) => {
      generateErrorMessage(err, toast);
    },
  });

  const { isLoading: isUpdating, mutate: updateNodeMutate } = useMutation(updateNode, {
    onSuccess: () => {
      generateSuccessMessage(t("nodes.nodeUpdated"), toast);
      queryClient.invalidateQueries(FetchNodesQueryKey);
      setEditingNode(null);
    },
    onError: (err) => {
      generateErrorMessage(err, toast);
    },
  });

  const { isLoading: isReconnecting, mutate: reconnect } = useMutation(reconnectNode, {
    onSuccess: () => {
      queryClient.invalidateQueries(FetchNodesQueryKey);
    },
  });

  const { mutate: toggleNodeStatus, isLoading: isToggling } = useMutation(updateNode, {
    onSuccess: () => {
      queryClient.invalidateQueries(FetchNodesQueryKey);
    },
    onError: (err) => {
      generateErrorMessage(err, toast);
    },
    onSettled: (_, __, variables: any) => {
      if (variables?.id != null) {
        setPendingStatus((prev) => {
          const next = { ...prev };
          delete next[variables.id as number];
          return next;
        });
      }
      setTogglingNodeId(null);
    },
  });

  const { isLoading: isResettingUsage, mutate: resetUsageMutate } = useMutation(resetNodeUsage, {
    onSuccess: () => {
      generateSuccessMessage(t("nodes.resetUsageSuccess", "Node usage reset"), toast);
      queryClient.invalidateQueries(FetchNodesQueryKey);
    },
    onError: (err) => {
      generateErrorMessage(err, toast);
    },
    onSettled: () => {
      setResettingNodeId(null);
      setResetCandidate(null);
      closeResetConfirm();
    },
  });

  const handleToggleNode = (node: NodeType) => {
    if (!node?.id) return;
    const isEnabled = node.status !== "disabled";
    const nextStatus = isEnabled ? "disabled" : "connecting";
    const nodeId = node.id as number;
    setTogglingNodeId(nodeId);
    setPendingStatus((prev) => ({ ...prev, [nodeId]: !isEnabled }));
    toggleNodeStatus({ ...node, status: nextStatus });
  };

  const handleResetNodeUsage = (node: NodeType) => {
    if (!node?.id) return;
    setResetCandidate(node);
    openResetConfirm();
  };

  const confirmResetUsage = () => {
    if (!resetCandidate?.id) return;
    setResettingNodeId(resetCandidate.id);
    resetUsageMutate(resetCandidate);
  };

  const handleCloseResetConfirm = () => {
    setResetCandidate(null);
    closeResetConfirm();
  };

  const closeVersionDialog = () => setVersionDialogTarget(null);
  const closeGeoDialog = () => setGeoDialogTarget(null);

  const handleVersionSubmit = async ({ version, persist }: { version: string; persist?: boolean }) => {
    if (!versionDialogTarget) {
      return;
    }

    if (versionDialogTarget.type === "master") {
      setUpdatingMasterCore(true);
      try {
        await apiFetch("/core/xray/update", {
          method: "POST",
          body: { version, persist_env: Boolean(persist) },
        });
        generateSuccessMessage(t("nodes.coreVersionDialog.masterUpdateSuccess", { version }), toast);
        await Promise.all([refetchCoreStats(), queryClient.invalidateQueries(FetchNodesQueryKey)]);
        closeVersionDialog();
      } catch (err) {
        generateErrorMessage(err, toast);
      } finally {
        setUpdatingMasterCore(false);
      }
      return;
    }

    if (versionDialogTarget.type === "bulk") {
      const targetNodes = (nodes ?? []).filter((node) => node.id != null && node.status === "connected");
      if (targetNodes.length === 0) {
        toast({
          title: t("nodes.coreVersionDialog.noConnectedNodes", "No connected nodes available for update."),
          status: "warning",
          isClosable: true,
          position: "top",
        });
        return;
      }

      setUpdatingBulkCore(true);
      try {
        const results: Array<{ status: "fulfilled" | "rejected"; node: NodeType }> = [];
        for (const node of targetNodes) {
          try {
            await apiFetch(`/node/${node.id}/xray/update`, {
              method: "POST",
              body: { version },
            });
            results.push({ status: "fulfilled", node });
          } catch (err) {
            results.push({ status: "rejected", node });
            generateErrorMessage(err, toast);
          }
        }

        const success = results.filter((result) => result.status === "fulfilled").length;
        const failed = results.length - success;
        const total = results.length;

        if (success > 0) {
          generateSuccessMessage(t("nodes.coreVersionDialog.bulkSuccess", { success, total }), toast);
        }
        if (failed > 0) {
          toast({
            title: t("nodes.coreVersionDialog.bulkPartialError", { failed, total }),
            status: "error",
            isClosable: true,
            position: "top",
            duration: 4000,
          });
        }

        queryClient.invalidateQueries(FetchNodesQueryKey);
        closeVersionDialog();
      } finally {
        setUpdatingBulkCore(false);
      }
      return;
    }

    if (versionDialogTarget.type === "node") {
      const targetNode = versionDialogTarget.node;
      if (!targetNode?.id) {
        return;
      }
      setUpdatingCoreNodeId(targetNode.id);
      try {
        await apiFetch(`/node/${targetNode.id}/xray/update`, {
          method: "POST",
          body: { version },
        });
        generateSuccessMessage(
          t("nodes.coreVersionDialog.nodeUpdateSuccess", {
            name: targetNode.name ?? t("nodes.unnamedNode", "Unnamed node"),
            version,
          }),
          toast
        );
        queryClient.invalidateQueries(FetchNodesQueryKey);
        closeVersionDialog();
      } catch (err) {
        generateErrorMessage(err, toast);
      } finally {
        setUpdatingCoreNodeId(null);
      }
    }
  };

  const handleGeoSubmit = async (payload: {
    mode: "template" | "manual";
    templateIndexUrl: string;
    templateName: string;
    files: { name: string; url: string }[];
    persistEnv: boolean;
    nodeId?: number;
  }) => {
    if (!geoDialogTarget) {
      return;
    }

    const body = {
      mode: payload.mode,
      template_index_url: payload.templateIndexUrl,
      template_name: payload.templateName,
      files: payload.files,
      persist_env: payload.persistEnv,
    };

    if (geoDialogTarget.type === "master") {
      setUpdatingMasterGeo(true);
      try {
        await apiFetch("/core/geo/update", { method: "POST", body });
        generateSuccessMessage(t("nodes.geoDialog.masterUpdateSuccess"), toast);
        closeGeoDialog();
      } catch (err) {
        generateErrorMessage(err, toast);
      } finally {
        setUpdatingMasterGeo(false);
      }
      return;
    }

    if (geoDialogTarget.type === "node") {
      const targetNode = geoDialogTarget.node;
      if (!targetNode?.id) {
        return;
      }
      setUpdatingGeoNodeId(targetNode.id);
      try {
        await apiFetch(`/node/${targetNode.id}/geo/update`, {
          method: "POST",
          body,
        });
        generateSuccessMessage(
          t("nodes.geoDialog.nodeUpdateSuccess", {
            name: targetNode.name ?? t("nodes.unnamedNode", "Unnamed node"),
          }),
          toast
        );
        queryClient.invalidateQueries(FetchNodesQueryKey);
        closeGeoDialog();
      } catch (err) {
        generateErrorMessage(err, toast);
      } finally {
        setUpdatingGeoNodeId(null);
      }
    }
  };

  const filteredNodes = useMemo(() => {
    if (!nodes) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return nodes;
    return nodes.filter((node) => {
      const name = (node.name ?? "").toLowerCase();
      const address = (node.address ?? "").toLowerCase();
      const version = (node.xray_version ?? "").toLowerCase();
      return name.includes(term) || address.includes(term) || version.includes(term);
    });
  }, [nodes, searchTerm]);

  const hasConnectedNodes = useMemo(
    () => (nodes ?? []).some((node) => node.id != null && node.status === "connected"),
    [nodes]
  );

  const errorMessage = useMemo(() => {
    if (!error) return undefined;
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (typeof error === "object" && "message" in error) {
      const possible = (error as { message?: unknown }).message;
      if (typeof possible === "string") return possible;
    }
    return t("errorOccurred");
  }, [error, t]);

  const hasError = Boolean(errorMessage);
  const masterLabel = t("nodes.masterNode", "Master");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const masterMatchesSearch =
    !normalizedSearch ||
    masterLabel.toLowerCase().includes(normalizedSearch) ||
    (coreStats?.version ?? "").toLowerCase().includes(normalizedSearch);

  const versionDialogLoading =
    versionDialogTarget?.type === "master"
      ? updatingMasterCore
      : versionDialogTarget?.type === "node"
      ? versionDialogTarget.node.id != null && updatingCoreNodeId === versionDialogTarget.node.id
      : versionDialogTarget?.type === "bulk"
      ? updatingBulkCore
      : false;

  const geoDialogLoading =
    geoDialogTarget?.type === "master"
      ? updatingMasterGeo
      : geoDialogTarget?.type === "node"
      ? geoDialogTarget.node.id != null && updatingGeoNodeId === geoDialogTarget.node.id
      : false;

  const versionDialogTitle =
    versionDialogTarget?.type === "master"
      ? t("nodes.coreVersionDialog.masterTitle")
      : versionDialogTarget?.type === "bulk"
      ? t("nodes.coreVersionDialog.bulkTitle")
      : versionDialogTarget?.type === "node"
      ? t("nodes.coreVersionDialog.nodeTitle", {
          name: versionDialogTarget.node.name ?? t("nodes.unnamedNode", "Unnamed node"),
        })
      : "";

  const versionDialogDescription =
    versionDialogTarget?.type === "master"
      ? t("nodes.coreVersionDialog.masterDescription")
      : versionDialogTarget?.type === "bulk"
      ? t("nodes.coreVersionDialog.bulkDescription")
      : versionDialogTarget?.type === "node"
      ? t("nodes.coreVersionDialog.nodeDescription", {
          name: versionDialogTarget.node.name ?? t("nodes.unnamedNode", "Unnamed node"),
        })
      : "";

  const versionDialogCurrentVersion =
    versionDialogTarget?.type === "master"
      ? coreStats?.version ?? ""
      : versionDialogTarget?.type === "node"
      ? versionDialogTarget.node.xray_version ?? ""
      : "";

  const geoDialogTitle =
    geoDialogTarget?.type === "master"
      ? t("nodes.geoDialog.masterTitle")
      : geoDialogTarget?.type === "node"
      ? t("nodes.geoDialog.nodeTitle", {
          name: geoDialogTarget.node.name ?? t("nodes.unnamedNode", "Unnamed node"),
        })
      : "";

  return (
    <VStack spacing={6} align="stretch">
      <Stack spacing={1}>
        <Text as="h1" fontWeight="semibold" fontSize="2xl">
          {t("header.nodes")}
        </Text>
        <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
          {t(
            "nodes.pageDescription",
            "Manage your master and satellite nodes. Update core versions, control availability, and edit node settings."
          )}
        </Text>
      </Stack>

      {hasError && (
        <Alert status="error" borderRadius="md">
          <AlertIcon />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Stack
        direction={{ base: "column", lg: "row" }}
        spacing={{ base: 3, lg: 4 }}
        alignItems={{ base: "stretch", lg: "center" }}
        justifyContent="space-between"
        w="full"
      >
        <Text fontWeight="semibold">{t("nodes.manageNodesHeader", "Node list")}</Text>
        <Stack
          direction={{ base: "column", md: "row" }}
          spacing={{ base: 3, md: 3 }}
          alignItems={{ base: "stretch", md: "center" }}
          justifyContent="flex-end"
          w={{ base: "full", lg: "auto" }}
        >
          <HStack
            spacing={2}
            alignItems="center"
            justifyContent="flex-end"
            w={{ base: "full", md: "auto" }}
          >
            <InputGroup size="sm" maxW={{ base: "full", md: "260px" }}>
              <InputLeftElement pointerEvents="none">
                <SearchIcon color="gray.400" />
              </InputLeftElement>
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t("nodes.searchPlaceholder", "Search nodes")}
              />
            </InputGroup>
            <Tooltip label={t("nodes.refreshNodes", "Refresh nodes")}>
              <IconButton
                aria-label={t("nodes.refreshNodes", "Refresh nodes")}
                icon={<ArrowPathIconStyled />}
                variant="ghost"
                size="sm"
                onClick={() => refetchNodes()}
                isLoading={isFetching}
              />
            </Tooltip>
          </HStack>
          <Stack
            direction={{ base: "column", sm: "row" }}
            spacing={2}
            justify="flex-end"
            alignItems={{ base: "flex-end", sm: "center" }}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVersionDialogTarget({ type: "bulk" })}
              isDisabled={!hasConnectedNodes}
              w={{ base: "auto", sm: "auto" }}
              px={{ base: 4, sm: 4 }}
            >
              {t("nodes.updateAllNodesCore")}
            </Button>
            <Button
              leftIcon={<AddIconStyled />}
              colorScheme="primary"
              size="sm"
              onClick={() => setAddNodeOpen(true)}
              w={{ base: "auto", sm: "auto" }}
              px={{ base: 4, sm: 5 }}
            >
              {t("nodes.addNode")}
            </Button>
          </Stack>
        </Stack>
      </Stack>

      {isLoading ? (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
          {Array.from({ length: 3 }).map((_, idx) => (
            <Box
              key={`nodes-skeleton-${idx}`}
              borderWidth="1px"
              borderRadius="lg"
              p={6}
              boxShadow="sm"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <VStack spacing={3}>
                <Spinner />
                <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                  {t("loading")}
                </Text>
              </VStack>
            </Box>
          ))}
        </SimpleGrid>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
          {masterMatchesSearch && (
            <Box
              key="master-node"
              borderWidth="1px"
              borderRadius="lg"
              p={6}
              boxShadow="sm"
              _hover={{ boxShadow: "md" }}
              transition="box-shadow 0.2s ease-in-out"
            >
              {isCoreLoading ? (
                <VStack spacing={3} align="center" justify="center">
                  <Spinner />
                  <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                    {t("loading")}
                  </Text>
                </VStack>
              ) : coreError ? (
                <VStack spacing={3} align="stretch">
                  <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                    {t("nodes.masterLoadFailed", "Unable to load master details.")}
                  </Text>
                  <Button size="sm" variant="outline" onClick={() => refetchCoreStats()}>
                    {t("refresh", "Refresh")}
                  </Button>
                </VStack>
              ) : (
                <VStack align="stretch" spacing={4}>
                  <Stack spacing={2}>
                    <HStack spacing={3} align="center" flexWrap="wrap">
                      <Text fontWeight="semibold" fontSize="lg">
                        {masterLabel}
                      </Text>
                      <Tag colorScheme="purple" size="sm">
                        {coreStats?.version
                          ? `Xray ${coreStats.version}`
                          : t("nodes.versionUnknown", "Version unknown")}
                      </Tag>
                    </HStack>
                    <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                      {coreStats?.started
                        ? t("nodes.masterStartedAt", {
                            date: dayjs(coreStats.started).local().format("YYYY-MM-DD HH:mm"),
                          })
                        : t("nodes.masterStartedUnknown", "Start time unavailable")}
                    </Text>
                  </Stack>
                  <Divider />
                  <Stack direction={{ base: "column", sm: "row" }} spacing={2}>
                    <Button
                      size="sm"
                      variant="outline"
                      colorScheme="primary"
                      onClick={() => setVersionDialogTarget({ type: "master" })}
                      isLoading={updatingMasterCore}
                    >
                      {t("nodes.coreVersionDialog.updateMasterButton")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setGeoDialogTarget({ type: "master" })}
                      isLoading={updatingMasterGeo}
                    >
                      {t("nodes.geoDialog.updateMasterButton")}
                    </Button>
                  </Stack>
                </VStack>
              )}
            </Box>
          )}

          {filteredNodes.length > 0 ? (
            filteredNodes.map((node) => {
              const status = node.status || "error";
              const nodeId = node?.id as number | undefined;
              const isEnabled = status !== "disabled" && status !== "limited";
              const pending = nodeId != null ? pendingStatus[nodeId] : undefined;
              const displayEnabled = pending ?? isEnabled;
              const isToggleLoading = nodeId != null && togglingNodeId === nodeId && isToggling;
              const isCoreUpdating = nodeId != null && updatingCoreNodeId === nodeId;
              const isGeoUpdating = nodeId != null && updatingGeoNodeId === nodeId;

              return (
                <Box
                  key={node.id ?? node.name}
                  borderWidth="1px"
                  borderRadius="lg"
                  p={6}
                  boxShadow="sm"
                  _hover={{ boxShadow: "md" }}
                  transition="box-shadow 0.2s ease-in-out"
                >
                  <VStack align="stretch" spacing={4}>
                    <Stack spacing={2}>
                      <HStack spacing={3} align="center" flexWrap="wrap">
                        <Text fontWeight="semibold" fontSize="lg">
                          {node.name || t("nodes.unnamedNode", "Unnamed node")}
                        </Text>
                        <Switch
                          size="sm"
                          colorScheme="primary"
                          isChecked={displayEnabled}
                          onChange={() => handleToggleNode(node)}
                          isDisabled={isToggleLoading}
                          aria-label={t("nodes.toggleAvailability", "Toggle node availability")}
                        />
                        {node.status === "error" && (
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<ArrowPathIconStyled />}
                            onClick={() => reconnect(node)}
                            isLoading={isReconnecting}
                          >
                            {t("nodes.reconnect")}
                          </Button>
                        )}
                      </HStack>
                      <HStack spacing={2} flexWrap="wrap">
                        <NodeModalStatusBadge status={status} compact />
                        <HStack spacing={1} align="center">
                          <Tag colorScheme="blue" size="sm">
                            {node.xray_version
                              ? `Xray ${node.xray_version}`
                              : t("nodes.versionUnknown", "Version unknown")}
                          </Tag>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="primary"
                            onClick={() => nodeId && setVersionDialogTarget({ type: "node", node })}
                            isLoading={isCoreUpdating}
                            isDisabled={!nodeId}
                          >
                            {t("nodes.updateCoreAction")}
                          </Button>
                        </HStack>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => nodeId && setGeoDialogTarget({ type: "node", node })}
                          isLoading={isGeoUpdating}
                          isDisabled={!nodeId}
                        >
                          {t("nodes.updateGeoAction", "Update geo")}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => handleResetNodeUsage(node)}
                          isLoading={isResettingUsage && nodeId != null && resettingNodeId === nodeId}
                          isDisabled={!nodeId}
                        >
                          {t("nodes.resetUsage", "Reset usage")}
                        </Button>
                      </HStack>
                      {status === "limited" && (
                        <Text fontSize="sm" color="red.500">
                          {t(
                            "nodes.limitedStatusDescription",
                            "This node is limited because its data limit is exhausted. Increase the limit or reset usage to reconnect it."
                          )}
                        </Text>
                      )}
                    </Stack>

                    <Divider />
                    <SimpleGrid columns={{ base: 1, sm: 2 }} spacingY={2}>
                      <Box>
                        <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                          {t("nodes.nodeAddress")}
                        </Text>
                        <Text fontWeight="medium">{node.address}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                          {t("nodes.nodePort")}
                        </Text>
                        <Text fontWeight="medium">{node.port}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                          {t("nodes.nodeAPIPort")}
                        </Text>
                        <Text fontWeight="medium">{node.api_port}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                          {t("nodes.usageCoefficient", "Usage coefficient")}
                        </Text>
                        <Text fontWeight="medium">{node.usage_coefficient}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                          {t("nodes.totalUsage", "Total usage")}
                        </Text>
                        <Text fontWeight="medium">
                          {formatBytes((node.uplink ?? 0) + (node.downlink ?? 0), 2)}
                        </Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                          {t("nodes.dataLimitLabel", "Data limit")}
                        </Text>
                        <Text fontWeight="medium">
                          {node.data_limit != null && node.data_limit > 0
                            ? formatBytes(node.data_limit, 2)
                            : t("nodes.unlimited", "Unlimited")}
                        </Text>
                      </Box>
                    </SimpleGrid>
                    <Divider />
                    <HStack justify="space-between" align="center" flexWrap="wrap" gap={2}>
                      <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                        {t("nodes.id", "ID")}: {node.id ?? "-"}
                      </Text>
                      <ButtonGroup size="sm" variant="ghost">
                        <IconButton
                          aria-label={t("edit")}
                          icon={<EditIconStyled />}
                          onClick={() => setEditingNode(node)}
                        />
                        <IconButton
                          aria-label={t("delete")}
                          icon={<DeleteIconStyled />}
                          colorScheme="red"
                          onClick={() => setDeletingNode(node)}
                        />
                      </ButtonGroup>
                    </HStack>
                  </VStack>
                </Box>
              );
            })
          ) : (
            <Box
              borderWidth="1px"
              borderRadius="lg"
              p={6}
              boxShadow="sm"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }} textAlign="center">
                {t("nodes.noNodesFound", "No nodes match the current filters.")}
              </Text>
            </Box>
          )}
        </SimpleGrid>
      )}

      <CoreVersionDialog
        isOpen={Boolean(versionDialogTarget)}
        onClose={closeVersionDialog}
        onSubmit={handleVersionSubmit}
        currentVersion={versionDialogCurrentVersion}
        title={versionDialogTitle}
        description={versionDialogDescription}
        allowPersist={versionDialogTarget?.type === "master"}
        isSubmitting={versionDialogLoading}
      />
      <GeoUpdateDialog
        isOpen={Boolean(geoDialogTarget)}
        onClose={closeGeoDialog}
        onSubmit={handleGeoSubmit}
        title={geoDialogTitle}
        showMasterOptions={geoDialogTarget?.type === "master"}
        isSubmitting={geoDialogLoading}
      />
      <AlertDialog
        isOpen={isResetConfirmOpen}
        leastDestructiveRef={cancelResetRef}
        onClose={handleCloseResetConfirm}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {t("nodes.resetUsage", "Reset usage")}
            </AlertDialogHeader>

            <AlertDialogBody>
              {t("nodes.resetUsageConfirm", "Are you sure you want to reset usage for {{name}}?", {
                name: resetCandidate?.name ?? resetCandidate?.address ?? t("nodes.thisNode", "this node"),
              })}
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelResetRef} onClick={handleCloseResetConfirm}>
                {t("cancel", "Cancel")}
              </Button>
              <Button colorScheme="red" onClick={confirmResetUsage} ml={3} isLoading={isResettingUsage}>
                {t("nodes.resetUsage", "Reset usage")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <NodeFormModal
        isOpen={isAddNodeOpen}
        onClose={() => setAddNodeOpen(false)}
        mutate={addNodeMutate}
        isLoading={isAdding}
        isAddMode
      />
      <NodeFormModal
        isOpen={!!editingNode}
        onClose={() => setEditingNode(null)}
        node={editingNode || undefined}
        mutate={updateNodeMutate}
        isLoading={isUpdating}
      />
      <DeleteNodeModal deleteCallback={() => queryClient.invalidateQueries(FetchNodesQueryKey)} />
    </VStack>
  );
};

export default NodesPage;


