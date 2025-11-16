import {
  BoxProps,
  Button,
  chakra,
  Grid,
  GridItem,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Spinner,
  Stack,
  useBreakpointValue,
} from "@chakra-ui/react";
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import classNames from "classnames";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import debounce from "lodash.debounce";
import React, { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AdminManagementPermission,
  AdminRole,
  AdminStatus,
  UserPermissionToggle,
} from "types/Admin";

const iconProps = {
  baseStyle: {
    w: 4,
    h: 4,
  },
};

const SearchIcon = chakra(MagnifyingGlassIcon, iconProps);
const ClearIcon = chakra(XMarkIcon, iconProps);
export const ReloadIcon = chakra(ArrowPathIcon, iconProps);
const PlusIconStyled = chakra(PlusIcon, iconProps);

export type FilterProps = { for?: "users" | "admins" } & BoxProps;

const setSearchField = debounce(
  (search: string, target: "users" | "admins") => {
    if (target === "users") {
      useDashboard.getState().onFilterChange({
        ...useDashboard.getState().filters,
        offset: 0,
        search,
      });
    } else {
      useAdminsStore.getState().onFilterChange({
        search,
        offset: 0,
      });
    }
  },
  300
);

export const Filters: FC<FilterProps> = ({ for: target = "users", ...props }) => {
  const {
    loading: usersLoading,
    filters: userFilters,
    onFilterChange: onUserFilterChange,
    refetchUsers,
    onCreateUser,
  } = useDashboard();
  const {
    loading: adminsLoading,
    filters: adminFilters,
    onFilterChange: onAdminFilterChange,
    fetchAdmins,
    openAdminDialog,
  } = useAdminsStore();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { userData } = useGetUser();
  const hasElevatedRole =
    userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
  const isCurrentAdminDisabled =
    !hasElevatedRole && userData.status === AdminStatus.Disabled;
  const canManageAdmins = Boolean(
    userData.permissions?.admin_management?.[AdminManagementPermission.Edit] ||
    userData.role === AdminRole.FullAccess
  );
  const canCreateUsers =
    hasElevatedRole ||
    Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
  const showCreateButton =
    target === "users"
      ? canCreateUsers && !isCurrentAdminDisabled
      : canManageAdmins;

  const loading = target === "users" ? usersLoading : adminsLoading;
  const filters = target === "users" ? userFilters : adminFilters;

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setSearchField(e.target.value, target);
  };
  const clear = () => {
    setSearch("");
    if (target === "users") {
      onUserFilterChange({
        ...filters,
        offset: 0,
        search: "",
      });
    } else {
      onAdminFilterChange({
        search: "",
        offset: 0,
      });
    }
  };

  const handleRefresh = () => {
    if (target === "users") {
      refetchUsers(true);
    } else {
      fetchAdmins();
    }
  };

  const handleCreate = () => {
    if (target === "users") {
      if (isCurrentAdminDisabled || !canCreateUsers) {
        return;
      }
      onCreateUser(true);
    } else {
      if (canManageAdmins) {
        openAdminDialog();
      }
    }
  };

  const isMobile = useBreakpointValue({ base: true, sm: false }) ?? false;

  return (
    <Grid
      id="filters"
      templateColumns={{
        lg: "repeat(3, 1fr)",
        md: "repeat(4, 1fr)",
        base: "repeat(1, 1fr)",
      }}
      mx="0"
      rowGap={4}
      gap={{
        lg: 4,
        base: 0,
      }}
      py={4}
      {...props}
    >
      <GridItem colSpan={{ base: 1, md: 2, lg: 1 }} order={{ base: 2, md: 1 }}>
        <HStack spacing={2} align="center" w="full">
          <InputGroup flex="1">
            <InputLeftElement pointerEvents="none" children={<SearchIcon />} />
            <Input
              placeholder={
                target === "users"
                  ? t("search")
                  : t("admins.searchPlaceholder", "Search admins...")
              }
              value={search}
              borderColor="light-border"
              w="full"
              onChange={onChange}
            />

            <InputRightElement>
              {loading && <Spinner size="xs" />}
              {filters.search && filters.search.length > 0 && (
                <IconButton
                  onClick={clear}
                  aria-label="clear"
                  size="xs"
                  variant="ghost"
                >
                  <ClearIcon />
                </IconButton>
              )}
            </InputRightElement>
          </InputGroup>
          <IconButton
            aria-label="refresh"
            disabled={loading}
            onClick={handleRefresh}
            size={isMobile ? "sm" : "md"}
            variant={isMobile ? "ghost" : "outline"}
            borderRadius="full"
            minW={isMobile ? "36px" : "40px"}
            h={isMobile ? "36px" : undefined}
          >
            <ReloadIcon
              className={classNames({
                "animate-spin": loading,
              })}
            />
          </IconButton>
        </HStack>
      </GridItem>
      <GridItem colSpan={{ base: 1, md: 2, lg: 2 }} order={{ base: 1, md: 2 }}>
        <Stack
          direction={{ base: "row", sm: "row" }}
          spacing={{ base: 2, sm: 3 }}
          justifyContent={{ base: "flex-start", md: "flex-end" }}
          alignItems="center"
          w="full"
          flexWrap="wrap"
        >
          {showCreateButton && (
            <Button
              colorScheme="primary"
              size={isMobile ? "sm" : "md"}
              onClick={handleCreate}
              isDisabled={target === "admins" && !canManageAdmins}
              px={isMobile ? 3 : 5}
              leftIcon={isMobile ? undefined : <PlusIconStyled />}
              w="auto"
              h={isMobile ? "36px" : undefined}
              minW={isMobile ? "auto" : "8.5rem"}
              fontSize={isMobile ? "sm" : "md"}
              fontWeight="semibold"
              whiteSpace="nowrap"
            >
              {target === "users"
                ? t("createUser")
                : t("admins.addAdmin", "Add admin")}
            </Button>
          )}
        </Stack>
      </GridItem>
    </Grid>
  );
};
