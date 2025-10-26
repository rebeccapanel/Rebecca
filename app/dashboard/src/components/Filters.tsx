import {
  BoxProps,
  Button,
  chakra,
  Grid,
  GridItem,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Spinner,
  Stack,
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
import debounce from "lodash.debounce";
import React, { FC, useState } from "react";
import { useTranslation } from "react-i18next";

const iconProps = {
  baseStyle: {
    w: 4,
    h: 4,
  },
};

const SearchIcon = chakra(MagnifyingGlassIcon, iconProps);
const ClearIcon = chakra(XMarkIcon, iconProps);
export const ReloadIcon = chakra(ArrowPathIcon, iconProps);

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
      refetchUsers();
    } else {
      fetchAdmins();
    }
  };

  const handleCreate = () => {
    if (target === "users") {
      onCreateUser(true);
    } else {
      openAdminDialog();
    }
  };

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
        <InputGroup>
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
      </GridItem>
      <GridItem colSpan={{ base: 1, md: 2, lg: 2 }} order={{ base: 1, md: 2 }}>
        <Stack
          direction={{ base: "column", sm: "row" }}
          spacing={3}
          justifyContent={{ base: "flex-start", md: "flex-end" }}
          alignItems={{ base: "stretch", sm: "center" }}
          w="full"
        >
          <IconButton
            aria-label="refresh"
            disabled={loading}
            onClick={handleRefresh}
            size="sm"
            variant="outline"
            w={{ base: "full", sm: "auto" }}
          >
            <ReloadIcon
              className={classNames({
                "animate-spin": loading,
              })}
            />
          </IconButton>
          <Button
            colorScheme="primary"
            size="sm"
            onClick={handleCreate}
            px={5}
            leftIcon={<PlusIcon width={16} />}
            w={{ base: "full", sm: "auto" }}
            justifyContent="center"
          >
            {target === "users"
              ? t("createUser")
              : t("admins.addAdmin", "Add admin")}
          </Button>
        </Stack>
      </GridItem>
    </Grid>
  );
};
