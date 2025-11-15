import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  Stack,
  Textarea,
  useColorModeValue,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { NoSymbolIcon } from "@heroicons/react/24/solid";
import { useAdminsStore } from "contexts/AdminsContext";
import type { Admin } from "types/Admin";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { formatBytes } from "utils/formatByte";

export const AdminsTable = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const rowHoverBg = useColorModeValue("gray.50", "whiteAlpha.100");
  const rowSelectedBg = useColorModeValue("primary.50", "primary.900");
  const dialogBg = useColorModeValue("surface.light", "surface.dark");
  const dialogBorderColor = useColorModeValue("light-border", "gray.700");
  const {
    admins,
    loading,
    total,
    filters,
    onFilterChange,
    fetchAdmins,
    deleteAdmin,
    resetUsage,
    disableAdmin,
    enableAdmin,
    openAdminDialog,
    openAdminDetails,
    adminInDetails,
  } = useAdminsStore();
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const disableCancelRef = useRef<HTMLButtonElement | null>(null);
  const {
    isOpen: isDeleteDialogOpen,
    onOpen: openDeleteDialog,
    onClose: closeDeleteDialog,
  } = useDisclosure();
  const {
    isOpen: isDisableDialogOpen,
    onOpen: openDisableDialog,
    onClose: closeDisableDialog,
  } = useDisclosure();
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
  const [adminToDisable, setAdminToDisable] = useState<Admin | null>(null);
  const [disableReason, setDisableReason] = useState("");
  const [actionState, setActionState] = useState<{
    type: "reset" | "disableAdmin" | "enableAdmin";
    username: string;
  } | null>(null);

  const handleSort = (column: "username" | "users_count" | "data" | "data_usage" | "data_limit") => {
    if (column === "data_usage" || column === "data_limit") {
      const newSort = filters.sort === column ? `-${column}` : column;
      onFilterChange({ sort: newSort, offset: 0 });
    } else {
      const newSort =
        filters.sort === column
          ? `-${column}`
          : filters.sort === `-${column}`
          ? undefined
          : column;
      onFilterChange({ sort: newSort, offset: 0 });
    }
  };

  const startDeleteDialog = (admin: Admin) => {
    setAdminToDelete(admin);
    openDeleteDialog();
  };

  const handleDeleteAdmin = async () => {
    if (!adminToDelete) return;
    try {
      await deleteAdmin(adminToDelete.username);
      generateSuccessMessage(t("admins.deleteSuccess", "Admin removed"), toast);
      closeDeleteDialog();
      setAdminToDelete(null);
    } catch (error) {
      generateErrorMessage(error, toast);
    }
  };

  const runResetUsage = async (admin: Admin) => {
    setActionState({ type: "reset", username: admin.username });
    try {
      await resetUsage(admin.username);
      generateSuccessMessage(
        t("admins.resetUsageSuccess", "Usage reset"),
        toast
      );
      fetchAdmins();
    } catch (error) {
      generateErrorMessage(error, toast);
    } finally {
      setActionState(null);
    }
  };

  const startDisableAdmin = (admin: Admin) => {
    setAdminToDisable(admin);
    setDisableReason("");
    openDisableDialog();
  };

  const closeDisableDialogAndReset = () => {
    closeDisableDialog();
    setAdminToDisable(null);
    setDisableReason("");
  };

  const confirmDisableAdmin = async () => {
    if (!adminToDisable) {
      return;
    }
    const reason = disableReason.trim();
    if (reason.length < 3) {
      return;
    }
    setActionState({ type: "disableAdmin", username: adminToDisable.username });
    try {
      await disableAdmin(adminToDisable.username, reason);
      generateSuccessMessage(
        t("admins.disableAdminSuccess", "Admin disabled"),
        toast
      );
      closeDisableDialogAndReset();
      fetchAdmins();
    } catch (error) {
      generateErrorMessage(error, toast);
    } finally {
      setActionState(null);
    }
  };

  const handleEnableAdmin = async (admin: Admin) => {
    setActionState({ type: "enableAdmin", username: admin.username });
    try {
      await enableAdmin(admin.username);
      generateSuccessMessage(
        t("admins.enableAdminSuccess", "Admin re-enabled"),
        toast
      );
      fetchAdmins();
    } catch (error) {
      generateErrorMessage(error, toast);
    } finally {
      setActionState(null);
    }
  };

  const SortIndicator = ({ column }: { column: string }) => {
    let isActive = false;
    let isDescending = false;
    if (column === "data") {
      isActive = filters.sort?.includes("data_usage") || filters.sort?.includes("data_limit");
      isDescending = isActive && filters.sort?.startsWith("-");
    } else {
      isActive = filters.sort?.includes(column);
      isDescending = isActive && filters.sort?.startsWith("-");
    }
    return (
      <ChevronDownIcon
        style={{
          width: "1rem",
          height: "1rem",
          opacity: isActive ? 1 : 0,
          transform:
            isActive && !isDescending ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
        }}
      />
    );
  };

  const columns = useMemo(
    () => [
      { key: "username", label: t("username") },
      { key: "data", label: t("dataUsage") + " / " + t("dataLimit") },
      { key: "users_count", label: t("users") },
      { key: "actions", label: "" },
    ],
    [t]
  );

  if (loading && !admins.length) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="200px"
      >
        <Spinner />
      </Box>
    );
  }

  if (!total) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="200px"
      >
        <Text>{t("admins.noAdmins")}</Text>
      </Box>
    );
  }

  return (
    <>
      <Box borderWidth="1px" borderRadius="md" overflowX="auto">
        <Table variant="simple" size="sm" minW="640px">
          <Thead>
            <Tr>
              {columns.map((col) => (
                <Th
                  key={col.key}
                  onClick={() =>
                    col.key === "username" || col.key === "users_count" || col.key === "data"
                      ? handleSort(col.key as "username" | "users_count" | "data")
                      : undefined
                  }
                  cursor={
                    col.key === "username" || col.key === "users_count" || col.key === "data"
                      ? "pointer"
                      : "default"
                  }
                  textAlign={col.key === "actions" ? "right" : "left"}
                >
                  <HStack justify={col.key === "actions" ? "flex-end" : "flex-start"}>
                    <Text>{col.label}</Text>
                    {col.key === "data" ? (
                      <Menu>
                        <MenuButton as={IconButton} size="xs" variant="ghost" icon={<SortIndicator column="data" />} />
                        <MenuList>
                          <MenuItem onClick={() => handleSort("data_usage")}>
                            {t("admins.sortByUsage")}
                          </MenuItem>
                          <MenuItem onClick={() => handleSort("data_limit")}>
                            {t("admins.sortByLimit")}
                          </MenuItem>
                        </MenuList>
                      </Menu>
                    ) : col.key === "username" || col.key === "users_count" ? (
                      <SortIndicator column={col.key as "username" | "users_count"} />
                    ) : null}
                  </HStack>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {admins.map((admin) => {
              const isSelected = adminInDetails?.username === admin.username;
              const usersLimitLabel =
                admin.users_limit && admin.users_limit > 0
                  ? String(admin.users_limit)
                  : "∞";
              const activeLabel = `${admin.active_users ?? 0}/${usersLimitLabel}`;

              return (
                <Tr
                  key={admin.username}
                  onClick={() => openAdminDetails(admin)}
                  cursor="pointer"
                  bg={isSelected ? rowSelectedBg : undefined}
                  _hover={{ bg: rowHoverBg }}
                  transition="background-color 0.15s ease-in-out"
                >
                  <Td>
                    <Text fontWeight="medium">{admin.username}</Text>
                    {admin.is_sudo && (
                      <Badge colorScheme="purple" fontSize="xs" mt={1}>
                        {t("sudo")}
                      </Badge>
                    )}
                    {!admin.is_sudo && admin.status === "disabled" && (
                      <Badge colorScheme="red" fontSize="xs" mt={1}>
                        {t("admins.disabledLabel", "Disabled")}
                      </Badge>
                    )}
                    {!admin.is_sudo && admin.status === "disabled" && admin.disabled_reason && (
                      <Text fontSize="xs" color="red.400" mt={1}>
                        {admin.disabled_reason}
                      </Text>
                    )}
                  </Td>
                  <Td>
                    <Text whiteSpace="nowrap">
                      {formatBytes(admin.users_usage ?? 0, 2)} /{" "}
                      {admin.data_limit ? (
                        formatBytes(admin.data_limit, 2)
                      ) : (
                        "-"
                      )}
                    </Text>
                  </Td>
                  <Td>
                    <Stack spacing={0}>
                      <Text fontSize="xs" color="gray.500">
                        {t("users")}
                      </Text>
                      <Text fontWeight="semibold">{activeLabel}</Text>
                    </Stack>
                  </Td>
                  <Td textAlign="right">
                    <Menu>
                      <MenuButton
                        as={IconButton}
                        icon={<EllipsisVerticalIcon width={20} />}
                        variant="ghost"
                        onClick={(event) => event.stopPropagation()}
                      />
                      <MenuList onClick={(event) => event.stopPropagation()}>
                        <MenuItem
                          icon={<PencilIcon width={20} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            openAdminDialog(admin);
                          }}
                        >
                          {t("edit")}
                        </MenuItem>
                        <MenuItem
                          icon={<ArrowPathIcon width={20} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            runResetUsage(admin);
                          }}
                          isDisabled={
                            actionState?.username === admin.username &&
                            actionState?.type === "reset"
                          }
                        >
                          {t("admins.resetUsage")}
                        </MenuItem>
                        <MenuDivider />
                        {!admin.is_sudo && admin.status !== "disabled" && (
                          <MenuItem
                            icon={<NoSymbolIcon width={20} />}
                            onClick={(event) => {
                              event.stopPropagation();
                              startDisableAdmin(admin);
                            }}
                            isDisabled={
                              actionState?.username === admin.username &&
                              actionState?.type === "disableAdmin"
                            }
                          >
                            {t("admins.disableAdmin", "Disable admin")}
                          </MenuItem>
                        )}
                        {!admin.is_sudo && admin.status === "disabled" && (
                          <MenuItem
                            icon={<PlayIcon width={20} />}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleEnableAdmin(admin);
                            }}
                            isDisabled={
                              actionState?.username === admin.username &&
                              actionState?.type === "enableAdmin"
                            }
                          >
                            {t("admins.enableAdmin", "Enable admin")}
                          </MenuItem>
                        )}
                        <MenuDivider />
                        <MenuItem
                          color="red.500"
                          icon={<TrashIcon width={20} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            startDeleteDialog(admin);
                          }}
                        >
                          {t("delete")}
                        </MenuItem>
                      </MenuList>
                    </Menu>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>
      <AlertDialog
        isOpen={isDeleteDialogOpen}
        leastDestructiveRef={deleteCancelRef}
        onClose={closeDeleteDialog}
      >
        <AlertDialogOverlay bg="blackAlpha.300" backdropFilter="blur(10px)">
          <AlertDialogContent bg={dialogBg} borderWidth="1px" borderColor={dialogBorderColor}>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {t("admins.confirmDeleteTitle", "Delete admin")}
            </AlertDialogHeader>
            <AlertDialogBody>
              {t(
                "admins.confirmDeleteMessage",
                "Are you sure you want to delete {{username}}?",
                {
                  username: adminToDelete?.username ?? "",
                }
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                ref={deleteCancelRef}
                onClick={closeDeleteDialog}
                variant="ghost"
                colorScheme="primary"
              >
                {t("cancel")}
              </Button>
              <Button colorScheme="red" onClick={handleDeleteAdmin} ml={3}>
                {t("delete")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
      <AlertDialog
        isOpen={isDisableDialogOpen}
        leastDestructiveRef={disableCancelRef}
        onClose={closeDisableDialogAndReset}
      >
        <AlertDialogOverlay bg="blackAlpha.300" backdropFilter="blur(10px)">
          <AlertDialogContent bg={dialogBg} borderWidth="1px" borderColor={dialogBorderColor}>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {t("admins.disableAdminTitle", "Disable admin")}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text mb={3}>
                {t(
                  "admins.disableAdminMessage",
                  "All users owned by {{username}} will be disabled. Provide a reason for this action.",
                  {
                    username: adminToDisable?.username ?? "",
                  }
                )}
              </Text>
              <Textarea
                value={disableReason}
                onChange={(event) => setDisableReason(event.target.value)}
                placeholder={t(
                  "admins.disableAdminReasonPlaceholder",
                  "Reason for disabling"
                )}
              />
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                ref={disableCancelRef}
                onClick={closeDisableDialogAndReset}
                variant="ghost"
                colorScheme="primary"
              >
                {t("cancel")}
              </Button>
              <Button
                colorScheme="red"
                onClick={confirmDisableAdmin}
                ml={3}
                isDisabled={disableReason.trim().length < 3}
                isLoading={
                  actionState?.type === "disableAdmin" &&
                  actionState?.username === adminToDisable?.username
                }
              >
                {t("admins.disableAdminConfirm", "Disable admin")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};
