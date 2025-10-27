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
  const {
    admins,
    loading,
    total,
    filters,
    onFilterChange,
    fetchAdmins,
    deleteAdmin,
    resetUsage,
    disableUsers,
    activateUsers,
    openAdminDialog,
    openAdminDetails,
    adminInDetails,
  } = useAdminsStore();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
  const [actionState, setActionState] = useState<{
    type: "reset" | "disable" | "activate";
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

  const openDeleteDialog = (admin: Admin) => {
    setAdminToDelete(admin);
    onOpen();
  };

  const handleDeleteAdmin = async () => {
    if (!adminToDelete) return;
    try {
      await deleteAdmin(adminToDelete.username);
      generateSuccessMessage(t("admins.deleteSuccess", "Admin removed"), toast);
      onClose();
      setAdminToDelete(null);
    } catch (error) {
      generateErrorMessage(error, toast);
    }
  };

  const runAction = async (
    type: "reset" | "disable" | "activate",
    admin: Admin
  ) => {
    setActionState({ type, username: admin.username });
    try {
      if (type === "reset") {
        await resetUsage(admin.username);
        generateSuccessMessage(
          t("admins.resetUsageSuccess", "Usage reset"),
          toast
        );
      } else if (type === "disable") {
        await disableUsers(admin.username);
        generateSuccessMessage(
          t("admins.disableUsersSuccess", "Users disabled"),
          toast
        );
      } else if (type === "activate") {
        await activateUsers(admin.username);
        generateSuccessMessage(
          t("admins.activateUsersSuccess", "Users activated"),
          toast
        );
      }
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
                            runAction("reset", admin);
                          }}
                          isDisabled={actionState?.username === admin.username}
                        >
                          {t("admins.resetUsage")}
                        </MenuItem>
                        <MenuDivider />
                        <MenuItem
                          icon={<PlayIcon width={20} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            runAction("activate", admin);
                          }}
                          isDisabled={actionState?.username === admin.username}
                        >
                          {t("admins.activateUsers")}
                        </MenuItem>
                        <MenuItem
                          icon={<NoSymbolIcon width={20} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            runAction("disable", admin);
                          }}
                          isDisabled={actionState?.username === admin.username}
                        >
                          {t("admins.disableUsers")}
                        </MenuItem>
                        <MenuDivider />
                        <MenuItem
                          color="red.500"
                          icon={<TrashIcon width={20} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            openDeleteDialog(admin);
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
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
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
              <Button ref={cancelRef} onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button colorScheme="red" onClick={handleDeleteAdmin} ml={3}>
                {t("delete")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};
