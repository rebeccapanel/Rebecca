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
import { AdminPermissions } from "types/Admin";

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

const userPermissionKeys: Array<{ key: keyof AdminPermissions["users"]; label: string }> = [
  { key: "create", label: "admins.permissions.createUser" },
  { key: "delete", label: "admins.permissions.deleteUser" },
  { key: "reset_usage", label: "admins.permissions.resetUsage" },
  { key: "revoke", label: "admins.permissions.revoke" },
  { key: "create_on_hold", label: "admins.permissions.createOnHold" },
  { key: "allow_unlimited_data", label: "admins.permissions.unlimitedData" },
  { key: "allow_unlimited_expire", label: "admins.permissions.unlimitedExpire" },
  { key: "allow_next_plan", label: "admins.permissions.nextPlan" },
];

const adminManagementKeys: Array<{ key: keyof AdminPermissions["admin_management"]; label: string }> =
  [
    { key: "can_view", label: "admins.permissions.viewAdmins" },
    { key: "can_edit", label: "admins.permissions.editAdmins" },
    { key: "can_manage_sudo", label: "admins.permissions.manageSudo" },
  ];

const sectionPermissionKeys: Array<{ key: keyof AdminPermissions["sections"]; label: string }> = [
  { key: "usage", label: "admins.sections.usage" },
  { key: "admins", label: "admins.sections.admins" },
  { key: "services", label: "admins.sections.services" },
  { key: "hosts", label: "admins.sections.hosts" },
  { key: "nodes", label: "admins.sections.nodes" },
  { key: "integrations", label: "admins.sections.integrations" },
  { key: "xray", label: "admins.sections.xray" },
];

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

  const updatePermissions = (path: ["users" | "admin_management" | "sections", string], next: boolean) => {
    const [section, key] = path;
    const updated: AdminPermissions = {
      ...value,
      [section]: {
        ...value[section],
        [key]: next,
      },
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
              onChange={(event) => updatePermissions(["users", key], event.target.checked)}
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
                    updatePermissions(["admin_management", key], event.target.checked)
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
                  onChange={(event) => updatePermissions(["sections", key], event.target.checked)}
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
