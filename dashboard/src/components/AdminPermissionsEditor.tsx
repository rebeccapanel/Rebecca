import {
  Button,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import {
  AdminManagementPermission,
  AdminPermissions,
  AdminSection,
  UserPermissionToggle,
} from "types/Admin";

type AdminPermissionsEditorProps = {
  value: AdminPermissions;
  onChange: (next: AdminPermissions) => void;
  maxDataLimitValue?: string;
  onMaxDataLimitChange?: (value: string) => void;
  maxDataLimitError?: string;
  showReset?: boolean;
  onReset?: () => void;
  hideExtendedSections?: boolean;
};

const userPermissionKeys: Array<{ key: UserPermissionToggle; label: string }> = [
  { key: UserPermissionToggle.Create, label: "admins.permissions.createUser" },
  { key: UserPermissionToggle.Delete, label: "admins.permissions.deleteUser" },
  { key: UserPermissionToggle.ResetUsage, label: "admins.permissions.resetUsage" },
  { key: UserPermissionToggle.Revoke, label: "admins.permissions.revoke" },
  { key: UserPermissionToggle.CreateOnHold, label: "admins.permissions.createOnHold" },
  {
    key: UserPermissionToggle.AllowUnlimitedData,
    label: "admins.permissions.unlimitedData",
  },
  {
    key: UserPermissionToggle.AllowUnlimitedExpire,
    label: "admins.permissions.unlimitedExpire",
  },
  { key: UserPermissionToggle.AllowNextPlan, label: "admins.permissions.nextPlan" },
];

const adminManagementKeys: Array<{ key: AdminManagementPermission; label: string }> = [
  { key: AdminManagementPermission.View, label: "admins.permissions.viewAdmins" },
  { key: AdminManagementPermission.Edit, label: "admins.permissions.editAdmins" },
  { key: AdminManagementPermission.ManageSudo, label: "admins.permissions.manageSudo" },
];

const sectionPermissionKeys: Array<{ key: AdminSection; label: string }> = [
  { key: AdminSection.Usage, label: "admins.sections.usage" },
  { key: AdminSection.Admins, label: "admins.sections.admins" },
  { key: AdminSection.Services, label: "admins.sections.services" },
  { key: AdminSection.Hosts, label: "admins.sections.hosts" },
  { key: AdminSection.Nodes, label: "admins.sections.nodes" },
  { key: AdminSection.Integrations, label: "admins.sections.integrations" },
  { key: AdminSection.Xray, label: "admins.sections.xray" },
];

type PermissionKeyMap = {
  users: UserPermissionToggle;
  admin_management: AdminManagementPermission;
  sections: AdminSection;
};

export const AdminPermissionsEditor = ({
  value,
  onChange,
  maxDataLimitValue,
  onMaxDataLimitChange,
  maxDataLimitError,
  showReset = false,
  onReset,
  hideExtendedSections = false,
}: AdminPermissionsEditorProps) => {
  const { t } = useTranslation();

  const updatePermissions = <T extends keyof PermissionKeyMap>(
    section: T,
    key: PermissionKeyMap[T],
    next: boolean
  ) => {
    const updatedSection = {
      ...value[section],
      [key]: next,
    } as AdminPermissions[T];
    const updated: AdminPermissions = {
      ...value,
      [section]: updatedSection,
    };
    onChange(updated);
  };

  const handleMaxDataLimitChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onMaxDataLimitChange?.(event.target.value);
  };

  return (
    <Stack spacing={6}>
      <HStack justify="space-between" align="center">
        <Text fontWeight="semibold">
          {t("admins.permissions.userCapabilities", "User capabilities")}
        </Text>
        {showReset && onReset && (
          <Button size="xs" variant="ghost" onClick={onReset}>
            {t("admins.permissions.resetToDefaults", "Reset to defaults")}
          </Button>
        )}
      </HStack>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
        {userPermissionKeys.map(({ key, label }) => (
          <HStack
            key={key}
            justify="space-between"
            borderWidth="1px"
            borderRadius="md"
            px={3}
            py={2}
          >
            <Text fontSize="sm">{t(label)}</Text>
            <Switch
              isChecked={Boolean(value.users[key])}
              onChange={(event) => updatePermissions("users", key, event.target.checked)}
            />
          </HStack>
        ))}
      </SimpleGrid>
      <FormControl isInvalid={Boolean(maxDataLimitError)}>
        <FormLabel>{t("admins.permissions.maxDataPerUser", "Max per user data (GB)")}</FormLabel>
        <Tooltip
          label={t(
            "admins.permissions.enableUnlimitedFirst",
            "Enable unlimited data first to set this value."
          )}
          isDisabled={Boolean(value.users.allow_unlimited_data)}
          hasArrow
          openDelay={200}
          placement="top"
          gutter={6}
          shouldWrapChildren
        >
          <Input
            type="number"
            min="0"
            step="1"
            placeholder={t("admins.permissions.maxDataHint", "Leave empty for unlimited")}
            value={maxDataLimitValue}
            onChange={handleMaxDataLimitChange}
            isDisabled={!value.users.allow_unlimited_data}
          />
        </Tooltip>
        {maxDataLimitError ? (
          <FormErrorMessage>{maxDataLimitError}</FormErrorMessage>
        ) : (
          <FormHelperText>
            {value.users.allow_unlimited_data
              ? t(
                  "admins.permissions.maxDataDescription",
                  "Applies when this admin creates or edits users."
                )
              : t(
                  "admins.permissions.limitDisabledHint",
                  "Unlimited data must be allowed before setting a cap."
                )}
          </FormHelperText>
        )}
      </FormControl>
      {!hideExtendedSections && (
        <Stack spacing={3}>
          <Text fontWeight="semibold">{t("admins.permissions.manageAdminsTitle", "Admin management")}</Text>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
            {adminManagementKeys.map(({ key, label }) => (
              <HStack
                key={key}
                justify="space-between"
                borderWidth="1px"
                borderRadius="md"
                px={3}
                py={2}
              >
                <Text fontSize="sm">{t(label)}</Text>
                <Switch
                  isChecked={Boolean(value.admin_management[key])}
                  onChange={(event) =>
                    updatePermissions("admin_management", key, event.target.checked)
                  }
                />
              </HStack>
            ))}
          </SimpleGrid>
        </Stack>
      )}
      {!hideExtendedSections && (
        <Stack spacing={3}>
          <Text fontWeight="semibold">{t("admins.permissions.sectionAccess", "Section access")}</Text>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
            {sectionPermissionKeys.map(({ key, label }) => (
              <HStack
                key={key}
                justify="space-between"
                borderWidth="1px"
                borderRadius="md"
                px={3}
                py={2}
              >
                <Text fontSize="sm">{t(label)}</Text>
                <Switch
                  isChecked={Boolean(value.sections[key])}
                  onChange={(event) => updatePermissions("sections", key, event.target.checked)}
                />
              </HStack>
            ))}
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
};

export default AdminPermissionsEditor;
