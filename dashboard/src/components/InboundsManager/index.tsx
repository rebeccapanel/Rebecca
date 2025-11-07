import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  Select,
  Spinner,
  Stack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Tag,
  Text,
  useDisclosure,
  useToast,
  useBreakpointValue,
} from "@chakra-ui/react";
import {
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetch } from "service/http";
import { buildInboundPayload, RawInbound, protocolOptions } from "utils/inbounds";
import { InboundFormValues } from "utils/inbounds";
import { fetchInbounds as refreshInboundsStore } from "contexts/DashboardContext";
import { InboundFormModal } from "./FormDrawer";

type FilterState = {
  protocol: string;
  search: string;
};

export const InboundsManager: FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [inbounds, setInbounds] = useState<RawInbound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>({ protocol: "all", search: "" });
  const [selected, setSelected] = useState<RawInbound | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const isDesktop = useBreakpointValue({ base: false, md: true });

  const loadInbounds = useCallback(() => {
    setIsLoading(true);
    setError(null);
    fetch<RawInbound[]>("/inbounds/full")
      .then((data) => {
        setInbounds(data || []);
      })
      .catch(() => {
        setError(t("inbounds.error.load", "Unable to load inbounds"));
      })
      .finally(() => setIsLoading(false));
  }, [t]);

  useEffect(() => {
    loadInbounds();
  }, [loadInbounds]);

  const filtered = useMemo(() => {
    const term = filter.search.trim().toLowerCase();
    return inbounds.filter((inbound) => {
      if (filter.protocol !== "all" && inbound.protocol !== filter.protocol) {
        return false;
      }
      if (!term) return true;
      return (
        inbound.tag.toLowerCase().includes(term) ||
        inbound.port?.toString().includes(term)
      );
    });
  }, [inbounds, filter]);

  const openCreate = () => {
    setDrawerMode("create");
    setSelected(null);
    onOpen();
  };

  const openEdit = (inbound: RawInbound) => {
    setDrawerMode("edit");
    setSelected(inbound);
    onOpen();
  };

  const handleSubmit = async (values: InboundFormValues) => {
    setIsMutating(true);
    try {
      const payload = buildInboundPayload(values);
      const url =
        drawerMode === "create"
          ? "/inbounds"
          : `/inbounds/${encodeURIComponent(payload.tag)}`;
      await fetch(url, { method: drawerMode === "create" ? "POST" : "PUT", body: payload });
      toast({
        status: "success",
        title:
          drawerMode === "create"
            ? t("inbounds.success.created", "Inbound created")
            : t("inbounds.success.updated", "Inbound updated"),
      });
      refreshInboundsStore();
      await loadInbounds();
      onClose();
    } catch (err: any) {
      toast({
        status: "error",
        title: t("inbounds.error.submit", "Unable to save inbound"),
        description: err?.data?.detail || err?.message,
      });
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (inbound: RawInbound) => {
    const confirmMessage = t("inbounds.confirmDelete", {
      defaultValue: "Delete inbound {{tag}}?",
      tag: inbound.tag,
    });
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setIsMutating(true);
    try {
      await fetch(`/inbounds/${encodeURIComponent(inbound.tag)}`, { method: "DELETE" });
      toast({
        status: "success",
        title: t("inbounds.success.deleted", "Inbound deleted"),
      });
      refreshInboundsStore();
      await loadInbounds();
    } catch (err: any) {
      toast({
        status: "error",
        title: t("inbounds.error.submit", "Unable to save inbound"),
        description: err?.data?.detail || err?.message,
      });
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <Stack spacing={4}>
      <Flex justify="space-between" flexWrap="wrap" gap={4}>
        <Input
          maxW="300px"
          placeholder={t("inbounds.searchPlaceholder", "Search by tag or port")}
          value={filter.search}
          onChange={(event) => setFilter((prev) => ({ ...prev, search: event.target.value }))}
        />
        <HStack spacing={3}>
          <Select
            width="180px"
            value={filter.protocol}
            onChange={(event) => setFilter((prev) => ({ ...prev, protocol: event.target.value }))}
          >
            <option value="all">{t("inbounds.filterProtocol", "All protocols")}</option>
            {protocolOptions.map((option) => (
              <option key={option} value={option}>
                {option.toUpperCase()}
              </option>
            ))}
          </Select>
          <Button
            leftIcon={<PlusIcon width={18} height={18} />}
            onClick={openCreate}
            colorScheme="primary"
          >
            {t("inbounds.add", "Add inbound")}
          </Button>
        </HStack>
      </Flex>

      {error && (
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Flex justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : filtered.length === 0 ? (
        <Box
          border="1px dashed"
          borderRadius="md"
          p={8}
          textAlign="center"
          color="gray.500"
        >
          {t("inbounds.emptyState", "No inbounds configured yet.")}
        </Box>
      ) : isDesktop ? (
        <Box borderWidth="1px" borderRadius="lg" overflow="hidden">
          <Table variant="simple" size="sm">
            <Thead bg="gray.50" _dark={{ bg: "gray.900" }}>
              <Tr>
                <Th>{t("inbounds.tag", "Tag")}</Th>
                <Th>{t("inbounds.protocol", "Protocol")}</Th>
                <Th>{t("inbounds.portLabel", "Port")}</Th>
                <Th>{t("inbounds.network", "Network")}</Th>
                <Th>{t("inbounds.security", "Security")}</Th>
                <Th>{t("inbounds.sniffing", "Sniffing")}</Th>
                <Th width="120px">{t("actions", "Actions")}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((inbound) => {
                const stream = inbound.streamSettings || {};
                return (
                  <Tr key={inbound.tag}>
                    <Td>
                      <Text fontWeight="semibold">{inbound.tag}</Text>
                      {inbound.listen && (
                        <Text fontSize="sm" color="gray.500">
                          {inbound.listen}
                        </Text>
                      )}
                    </Td>
                    <Td>
                      <Tag colorScheme="purple">{inbound.protocol}</Tag>
                    </Td>
                    <Td>{inbound.port}</Td>
                    <Td>{stream.network || "—"}</Td>
                    <Td>
                      {stream.security && stream.security !== "none" ? (
                        <Tag colorScheme="blue">{stream.security}</Tag>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {inbound.sniffing?.enabled ? (
                        <Tag size="sm" colorScheme="green">
                          {t("inbounds.sniffingEnabled", "Sniffing enabled")}
                        </Tag>
                      ) : (
                        <Tag size="sm" colorScheme="gray">
                          {t("inbounds.sniffingDisabled", "Sniffing disabled")}
                        </Tag>
                      )}
                    </Td>
                    <Td>
                      <HStack spacing={2}>
                        <IconButton
                          aria-label={t("common.edit", "Edit")}
                          icon={<PencilIcon width={16} height={16} />}
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(inbound)}
                        />
                        <IconButton
                          aria-label={t("common.delete", "Delete")}
                          icon={<TrashIcon width={16} height={16} />}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(inbound)}
                          isLoading={isMutating}
                        />
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      ) : (
        <Stack spacing={3}>
          {filtered.map((inbound) => {
            const stream = inbound.streamSettings || {};
            return (
              <Box
                key={inbound.tag}
                borderWidth="1px"
                borderRadius="lg"
                p={4}
              >
                <Flex justify="space-between" align="center" mb={2}>
                  <Box>
                    <Text fontWeight="semibold">{inbound.tag}</Text>
                    <Text fontSize="sm" color="gray.500">
                      {t("inbounds.portLabel", "Port")}: {inbound.port}
                    </Text>
                  </Box>
                  <HStack spacing={2}>
                    <IconButton
                      aria-label={t("common.edit", "Edit")}
                      icon={<PencilIcon width={16} height={16} />}
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(inbound)}
                    />
                    <IconButton
                      aria-label={t("common.delete", "Delete")}
                      icon={<TrashIcon width={16} height={16} />}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(inbound)}
                      isLoading={isMutating}
                    />
                  </HStack>
                </Flex>
                <Stack spacing={2}>
                  <HStack spacing={2} wrap="wrap">
                    <Tag colorScheme="purple">{inbound.protocol}</Tag>
                    {stream.network && <Tag>{stream.network}</Tag>}
                    {stream.security && stream.security !== "none" && (
                      <Tag colorScheme="blue">{stream.security}</Tag>
                    )}
                  </HStack>
                  <HStack spacing={2} wrap="wrap">
                    {inbound.sniffing?.enabled ? (
                      <Tag size="sm" colorScheme="green">
                        {t("inbounds.sniffingEnabled", "Sniffing enabled")}
                      </Tag>
                    ) : (
                      <Tag size="sm" colorScheme="gray">
                        {t("inbounds.sniffingDisabled", "Sniffing disabled")}
                      </Tag>
                    )}
                    {inbound.listen && (
                      <Tag size="sm" colorScheme="gray">
                        {inbound.listen}
                      </Tag>
                    )}
                  </HStack>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}

      <InboundFormModal
        isOpen={isOpen}
        mode={drawerMode}
        initialValue={selected}
        isSubmitting={isMutating}
        onClose={onClose}
        onSubmit={handleSubmit}
      />
    </Stack>
  );
};
