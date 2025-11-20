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
  Slider,
  SliderFilledTrack,
  SliderProps,
  SliderTrack,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  Stack,
  Textarea,
  useColorModeValue,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { NoSymbolIcon } from "@heroicons/react/24/solid";
import { useAdminsStore } from "contexts/AdminsContext";
import type { Admin } from "types/Admin";
import { AdminManagementPermission, AdminRole, AdminStatus } from "types/Admin";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useGetUser from "hooks/useGetUser";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { formatBytes } from "utils/formatByte";
import AdminPermissionsModal from "./AdminPermissionsModal";
import { FC } from "react";
import { chakra } from "@chakra-ui/react";

const ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted";

const iconProps = {
  baseStyle: {
    strokeWidth: "2px",
    w: 3,
    h: 3,
  },
};

const ActiveAdminStatusIcon = chakra(CheckCircleIcon, iconProps);
const DisabledAdminStatusIcon = chakra(XCircleIcon, iconProps);

const AdminStatusBadge: FC<{ status: AdminStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const isActive = status === AdminStatus.Active;
  const Icon = isActive ? ActiveAdminStatusIcon : DisabledAdminStatusIcon;

  const badgeStyles = useColorModeValue(
    {
      bg: isActive ? "green.100" : "red.100",
      color: isActive ? "green.800" : "red.800",
    },
    {
      bg: isActive ? "green.900" : "red.900",
      color: isActive ? "green.200" : "red.200",
    }
  );

  return (
    <Box
      display="inline-flex"
      alignItems="center"
      columnGap={1}
      px={2}
      py={0.5}
      borderRadius="md"
      bg={badgeStyles.bg}
      color={badgeStyles.color}
      fontSize="xs"
      fontWeight="medium"
      lineHeight="1"
      w="fit-content"
    >
      <Icon w={3} h={3} />
      <Text textTransform="capitalize">
        {isActive ? t("status.active", "Active") : t("admins.disabledLabel", "Disabled")}
      </Text>
    </Box>
  );
};

type AdminUsageSliderProps = {
  used: number;
  total: number | null;
  lifetimeUsage: number | null;
} & SliderProps;

const AdminUsageSlider: FC<AdminUsageSliderProps> = (props) => {
  const { used, total, lifetimeUsage, ...restOfProps } = props;
  const isUnlimited = total === 0 || total === null;
  const isReached = !isUnlimited && (used / total) * 100 >= 100;
  return (
    <Stack spacing={2} width="100%">
      <Slider
        orientation="horizontal"
        value={isUnlimited ? 100 : Math.min((used / total) * 100, 100)}
        colorScheme={isReached ? "red" : "primary"}
        {...restOfProps}
      >
        <SliderTrack h="6px" borderRadius="full">
          <SliderFilledTrack borderRadius="full" />
        </SliderTrack>
      </Slider>
      <HStack
        justifyContent="space-between"
        fontSize="xs"
        fontWeight="medium"
        color="gray.600"
        _dark={{
          color: "gray.400",
        }}
        flexWrap="wrap"
      >
        <Text>
          {formatBytes(used, 2)} /{" "}
          {isUnlimited ? (
            <Text as="span" fontFamily="system-ui">
              ∞
            </Text>
          ) : (
            formatBytes(total, 2)
          )}
        </Text>
        {lifetimeUsage !== null && lifetimeUsage !== undefined && (
          <Text color="blue.500" _dark={{ color: "blue.300" }}>
            lifetime: {formatBytes(lifetimeUsage, 2)}
          </Text>
        )}
      </HStack>
    </Stack>
  );
};

export const AdminsTable = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { userData } = useGetUser();
  const rowHoverBg = useColorModeValue("gray.50", "whiteAlpha.100");
  const rowSelectedBg = useColorModeValue("primary.50", "primary.900");
  const tableBg = useColorModeValue("white", "gray.900");
  const tableBorderColor = useColorModeValue("gray.100", "whiteAlpha.200");
  const tableHeaderBg = useColorModeValue("gray.50", "whiteAlpha.100");
  const tableHeaderBorderColor = useColorModeValue("gray.100", "whiteAlpha.200");
  const tableHeaderTextColor = useColorModeValue("gray.600", "gray.300");
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
  const {
    isOpen: isPermissionsModalOpen,
    onOpen: openPermissionsModal,
    onClose: closePermissionsModal,
  } = useDisclosure();
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
  const [adminToDisable, setAdminToDisable] = useState<Admin | null>(null);
  const [disableReason, setDisableReason] = useState("");
  const [actionState, setActionState] = useState<{
    type: "reset" | "disableAdmin" | "enableAdmin";
    username: string;
  } | null>(null);
  const [adminForPermissions, setAdminForPermissions] = useState<Admin | null>(null);
  const maxIdDigits = useMemo(() => {
    if (!admins.length) return 0;
    return admins.reduce((max, admin) => Math.max(max, String(admin.id ?? "").length), 0);
  }, [admins]);
  const idColumnWidth = maxIdDigits ? `calc(${maxIdDigits}ch + 5px)` : undefined;
  const idColumnMaxWidth = "120px";
  const currentAdminUsername = userData.username;
  const hasFullAccess = userData.role === AdminRole.FullAccess;
  const adminManagement = userData.permissions?.admin_management;
  const canEditAdmins = Boolean(
    adminManagement?.[AdminManagementPermission.Edit] || hasFullAccess
  );
  const canManageSudoAdmins = Boolean(
    adminManagement?.[AdminManagementPermission.ManageSudo] || hasFullAccess
  );
  const canManageAdminAccount = (target: Admin) => {
    if (target.username === currentAdminUsername) {
      return true;
    }
    if (target.role === AdminRole.FullAccess) {
      return false;
    }
    if (!canEditAdmins) {
      return false;
    }
    if (target.role === AdminRole.Sudo) {
      return canManageSudoAdmins;
    }
    return true;
  };

  const handleSort = (column: "username" | "users_count" | "data" | "data_usage" | "data_limit" | "id") => {
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

  const handleOpenPermissionsModal = (admin: Admin) => {
    setAdminForPermissions(admin);
    openPermissionsModal();
  };

  const handleClosePermissionsModal = () => {
    setAdminForPermissions(null);
    closePermissionsModal();
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
      { key: "id", label: "ID" },
      { key: "username", label: t("username") },
      { key: "status", label: t("status") },
      { key: "users_count", label: t("users") },
      { key: "data", label: t("dataUsage") + " / " + t("dataLimit") },
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
      <Box
        borderWidth="1px"
        borderRadius="md"
        overflowX="auto"
        bg={tableBg}
        borderColor={tableBorderColor}
      >
        <Table variant="simple" size="sm" minW={{ base: "100%", md: "800px" }}>
          <Thead bg={tableHeaderBg} color={tableHeaderTextColor}>
            <Tr>
              {columns.map((col) => (
                <Th
                  key={col.key}
                  onClick={() =>
                    col.key === "username" || col.key === "users_count" || col.key === "data" || col.key === "id"
                      ? handleSort(col.key as "username" | "users_count" | "data" | "id")
                      : undefined
                  }
                  borderRight={col.key === "id" ? "1px solid" : undefined}
                  borderColor={col.key === "id" ? tableHeaderBorderColor : "transparent"}
                  cursor={
                    col.key === "username" || col.key === "users_count" || col.key === "data" || col.key === "id"
                      ? "pointer"
                      : "default"
                  }
                  textAlign={col.key === "actions" ? "right" : "left"}
                  display={{ base: col.key === "id" ? "none" : "table-cell", md: "table-cell" }}
                  px={col.key === "id" ? 1 : undefined}
                  width={col.key === "id" ? idColumnWidth : undefined}
                  minW={col.key === "id" ? idColumnWidth : undefined}
                  maxW={col.key === "id" ? idColumnMaxWidth : undefined}
                  whiteSpace={col.key === "id" ? "nowrap" : undefined}
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
                    ) : col.key === "username" || col.key === "users_count" || col.key === "id" ? (
                      <SortIndicator column={col.key as "username" | "users_count" | "id"} />
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
              const canManageThisAdmin = canManageAdminAccount(admin);
              const canChangeStatus = canManageThisAdmin && admin.username !== currentAdminUsername;
              const showDisableAction =
                canChangeStatus && admin.status !== AdminStatus.Disabled;
              const hasLimitDisabledReason =
                admin.disabled_reason === ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY;
              const disabledReasonLabel = admin.disabled_reason
                ? hasLimitDisabledReason
                  ? t(
                      "admins.disabledReason.dataLimitExceeded",
                      "Your data limit has been reached"
                    )
                  : admin.disabled_reason
                : null;
              const showEnableAction =
                canChangeStatus && admin.status === AdminStatus.Disabled && !hasLimitDisabledReason;
              const showDeleteAction = canChangeStatus;

              return (
                <Tr
                  key={admin.username}
                  onClick={() => openAdminDetails(admin)}
                  cursor="pointer"
                  bg={isSelected ? rowSelectedBg : undefined}
                  _hover={{ bg: rowHoverBg }}
                  transition="background-color 0.15s ease-in-out"
                >
                  <Td 
                    display={{ base: "none", md: "table-cell" }} 
                    px={1} 
                    pr={1}
                    borderRight="1px solid" 
                    borderColor="gray.200" 
                    _dark={{ borderColor: "gray.700" }}
                    width={idColumnWidth}
                    minW={idColumnWidth}
                    maxW={idColumnMaxWidth}
                    whiteSpace="nowrap"
                    overflow="hidden"
                    textOverflow="ellipsis"
                  >
                    <Text fontWeight="medium" color="gray.700" _dark={{ color: "gray.300" }} fontSize="sm">
                      {admin.id}
                    </Text>
                  </Td>
                  <Td px={2}>
                    <Tooltip
                      label={
                        admin.role === AdminRole.FullAccess
                          ? t("admins.roles.fullAccess", "Full access")
                          : admin.role === AdminRole.Sudo
                          ? t("admins.roles.sudo", "Sudo")
                          : t("admins.roles.standard", "Standard")
                      }
                      placement="top"
                    >
                      <Text
                        fontWeight="medium"
                        px={2}
                        py={1}
                        borderRadius="md"
                        bg={
                          admin.role === AdminRole.FullAccess
                            ? "yellow.100"
                            : admin.role === AdminRole.Sudo
                            ? "purple.100"
                            : "gray.100"
                        }
                        color={
                          admin.role === AdminRole.FullAccess
                            ? "yellow.800"
                            : admin.role === AdminRole.Sudo
                            ? "purple.800"
                            : "gray.800"
                        }
                        _dark={{
                          bg:
                            admin.role === AdminRole.FullAccess
                              ? "yellow.900"
                              : admin.role === AdminRole.Sudo
                              ? "purple.900"
                              : "gray.700",
                          color:
                            admin.role === AdminRole.FullAccess
                              ? "yellow.200"
                              : admin.role === AdminRole.Sudo
                              ? "purple.200"
                              : "gray.200",
                        }}
                        display="inline-block"
                      >
                        {admin.username}
                      </Text>
                    </Tooltip>
                  </Td>
                  <Td>
                    <Stack spacing={1} align="flex-start" maxW="full">
                      <AdminStatusBadge status={admin.status} />
                      {admin.status === AdminStatus.Disabled && disabledReasonLabel && (
                        <Text fontSize="xs" color="red.400" mt={1}>
                          {disabledReasonLabel}
                        </Text>
                      )}
                    </Stack>
                  </Td>
                  <Td>
                    <Stack spacing={0}>
                      <Text fontSize="xs" fontWeight="semibold">
                        {activeLabel}
                      </Text>
                      {admin.online_users !== null && admin.online_users !== undefined && (
                        <HStack spacing={1} mt={1}>
                          <Text fontSize="xs" color="green.600" _dark={{ color: "green.400" }}>
                            {t("admins.details.onlineLabel", "Online")}:
                          </Text>
                          <Text fontSize="xs" fontWeight="semibold" color="green.600" _dark={{ color: "green.400" }}>
                            {admin.online_users}
                          </Text>
                        </HStack>
                      )}
                    </Stack>
                  </Td>
                  <Td>
                    <AdminUsageSlider
                      used={admin.users_usage ?? 0}
                      total={admin.data_limit ?? null}
                      lifetimeUsage={admin.lifetime_usage ?? null}
                    />
                  </Td>
                  <Td textAlign="right">
                    <Menu>
                      <MenuButton
                        as={IconButton}
                        icon={<EllipsisVerticalIcon width={20} />}
                        variant="ghost"
                        isDisabled={!canManageThisAdmin && !canChangeStatus}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <MenuList onClick={(event) => event.stopPropagation()}>
                        {canManageThisAdmin && (
                          <>
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
                              icon={<AdjustmentsHorizontalIcon width={20} />}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenPermissionsModal(admin);
                              }}
                            >
                              {t("admins.editPermissionsButton", "Edit permissions")}
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
                          </>
                        )}
                        {(showDisableAction || showEnableAction || showDeleteAction) && canManageThisAdmin && (
                          <MenuDivider />
                        )}
                        {showDisableAction && (
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
                        {showEnableAction && (
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
                        {showDeleteAction && (showDisableAction || showEnableAction) && <MenuDivider />}
                        {showDeleteAction && (
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
                        )}
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
      <AdminPermissionsModal
        isOpen={isPermissionsModalOpen}
        onClose={handleClosePermissionsModal}
        admin={adminForPermissions}
      />
    </>
  );
};
