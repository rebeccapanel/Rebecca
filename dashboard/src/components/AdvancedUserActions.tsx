import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  NumberInput,
  NumberInputField,
  Select,
  Stack,
  Text,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import { AdminRole } from "types/Admin";
import {
  AdvancedUserActionPayload,
  AdvancedUserActionStatus,
  AdvancedUserActionType,
} from "types/User";
import { useAdminsStore } from "contexts/AdminsContext";

const cleanupOptions: AdvancedUserActionStatus[] = ["expired", "limited"];

type OwnerSelection = "my_users" | "all_users" | `admin:${string}`;

const AdvancedUserActions = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { performBulkUserAction } = useDashboard();
  const { userData } = useGetUser();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [expireDays, setExpireDays] = useState("");
  const [trafficGb, setTrafficGb] = useState("");
  const [cleanupDays, setCleanupDays] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<AdvancedUserActionStatus[]>([
    "expired",
    "limited",
  ]);
  const [isExtending, setIsExtending] = useState(false);
  const [isReducing, setIsReducing] = useState(false);
  const [isIncreasingTraffic, setIsIncreasingTraffic] = useState(false);
  const [isDecreasingTraffic, setIsDecreasingTraffic] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [ownerSelection, setOwnerSelection] = useState<OwnerSelection>("my_users");
  const { admins: adminList, fetchAdmins } = useAdminsStore();

  const hasScopeSelect =
    userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;

  useEffect(() => {
    if (isOpen && hasScopeSelect) {
      fetchAdmins({ limit: 200, offset: 0 });
    }
  }, [fetchAdmins, hasScopeSelect, isOpen]);

  const resolveTargetAdminUsername = () => {
    if (!hasScopeSelect) {
      return userData.username;
    }
    if (ownerSelection === "all_users") {
      return null;
    }
    if (ownerSelection === "my_users") {
      return userData.username;
    }
    if (ownerSelection.startsWith("admin:")) {
      return ownerSelection.replace(/^admin:/, "");
    }
    return userData.username;
  };

  const showToast = (description: string, status: "success" | "error" | "warning") => {
    toast({
      title: t("filters.advancedActions.modalTitle", "Advanced actions"),
      description,
      status,
      isClosable: true,
    });
  };

  const handleError = (message?: string) => {
    showToast(
      message ?? t("filters.advancedActions.error.general", "Unable to perform action"),
      "error"
    );
  };

  const handleExpireAction = async (action: AdvancedUserActionType) => {
    const days = Number(expireDays);
    if (!Number.isFinite(days) || days <= 0) {
      showToast(
        t("filters.advancedActions.error.invalidDays", "Enter a positive number of days"),
        "warning"
      );
      return;
    }
    const setLoading = action === "extend_expire" ? setIsExtending : setIsReducing;
    setLoading(true);
    try {
      const targetAdminUsername = resolveTargetAdminUsername();
      const payload: AdvancedUserActionPayload = {
        action,
        days: Math.floor(days),
        admin_username: targetAdminUsername,
      };
      const result = await performBulkUserAction(payload);
      showToast(
        t("filters.advancedActions.success.expire", {
          count: result.count ?? 0,
        }),
        "success"
      );
      setExpireDays("");
    } catch (error) {
      handleError();
    } finally {
      setLoading(false);
    }
  };

  const handleTrafficAction = async (action: AdvancedUserActionType) => {
    const value = Number(trafficGb);
    if (!Number.isFinite(value) || value <= 0) {
      showToast(
        t("filters.advancedActions.error.invalidGigabytes", "Enter a positive traffic value"),
        "warning"
      );
      return;
    }
    const setLoading = action === "increase_traffic" ? setIsIncreasingTraffic : setIsDecreasingTraffic;
    setLoading(true);
    try {
      const targetAdminUsername = resolveTargetAdminUsername();
      const payload: AdvancedUserActionPayload = {
        action,
        gigabytes: value,
        admin_username: targetAdminUsername,
      };
      const result = await performBulkUserAction(payload);
      showToast(
        t("filters.advancedActions.success.traffic", {
          count: result.count ?? 0,
          value,
        }),
        "success"
      );
      setTrafficGb("");
    } catch (error) {
      handleError();
    } finally {
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    const days = Number(cleanupDays);
    if (!Number.isFinite(days) || days <= 0) {
      showToast(
        t("filters.advancedActions.error.invalidDays", "Enter a positive number of days"),
        "warning"
      );
      return;
    }
    if (!selectedStatuses.length) {
      showToast(
        t("filters.advancedActions.error.noStatuses", "Select at least one status"),
        "warning"
      );
      return;
    }
    setIsCleaning(true);
    try {
      const targetAdminUsername = resolveTargetAdminUsername();
      const payload: AdvancedUserActionPayload = {
        action: "cleanup_status",
        days: Math.floor(days),
        statuses: selectedStatuses,
        admin_username: targetAdminUsername,
      };
      const result = await performBulkUserAction(payload);
      showToast(
        t("filters.advancedActions.success.cleanup", {
          count: result.count ?? 0,
        }),
        "success"
      );
      setCleanupDays("");
    } catch (error) {
      handleError();
    } finally {
      setIsCleaning(false);
    }
  };

  const toggleStatus = (status: AdvancedUserActionStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status]
    );
  };

  return (
    <>
      <Button
        leftIcon={<SparklesIcon className="w-4 h-4" />}
        onClick={onOpen}
        size="sm"
        variant="outline"
      >
        {t("filters.advancedActions.button", "Advanced actions")}
      </Button>

      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("filters.advancedActions.modalTitle", "Advanced actions")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={6} align="stretch">
              <Alert status="warning" borderRadius="md">
                <AlertIcon />
                <Text>
                  {t(
                    "filters.advancedActions.modalDescription",
                    "These tools update every user and cannot be undone. Please double-check the values before confirming."
                  )}
                </Text>
              </Alert>

              {hasScopeSelect && (
                <FormControl>
                  <FormLabel fontWeight="semibold">
                    {t("filters.advancedActions.scope.label", "Scope")}
                  </FormLabel>
                  <Select
                    value={ownerSelection}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (
                        nextValue === "my_users" ||
                        nextValue === "all_users" ||
                        nextValue.startsWith("admin:")
                      ) {
                        setOwnerSelection(nextValue as OwnerSelection);
                      }
                    }}
                    size="sm"
                  >
                    <option value="my_users">
                      {t("filters.advancedActions.scope.myUsers", "My users")}
                    </option>
                    <option value="all_users">
                      {t("filters.advancedActions.scope.allUsers", "All users")}
                    </option>
                    {adminList
                      .filter((record) => record.username !== userData.username)
                      .map((record) => (
                        <option key={record.username} value={`admin:${record.username}`}>
                          {record.username}
                        </option>
                      ))}
                  </Select>
                  <FormHelperText fontSize="sm">
                    {t(
                      "filters.advancedActions.scope.helper",
                      "Select an admin or all users for this action."
                    )}
                  </FormHelperText>
                </FormControl>
              )}

              <Stack spacing={4}>
                <Box borderWidth="1px" borderRadius="md" px={4} py={4}>
                  <Stack spacing={2}>
                    <Text fontWeight="semibold">
                      {t("filters.advancedActions.expireSection.title", "Expiration dates")}
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      {t(
                        "filters.advancedActions.expireSection.description",
                        "Add or subtract days from every user's expiration timestamp."
                      )}
                    </Text>
                    <FormControl>
                      <FormLabel>
                        {t("filters.advancedActions.expireSection.inputLabel", "Days")}
                      </FormLabel>
                      <NumberInput
                        value={expireDays}
                        onChange={setExpireDays}
                        min={1}
                        step={1}
                        w="full"
                      >
                        <NumberInputField />
                      </NumberInput>
                      <FormHelperText>
                        {t(
                          "filters.advancedActions.expireSection.helper",
                          "The entered value will be added or removed when you click a button."
                        )}
                      </FormHelperText>
                    </FormControl>
                    <HStack spacing={2} flexWrap="wrap">
                      <Button
                        colorScheme="primary"
                        isLoading={isExtending}
                        flex="1"
                        minW="150px"
                        onClick={() => handleExpireAction("extend_expire")}
                      >
                        {t(
                          "filters.advancedActions.expireSection.addButton",
                          "Add days to all users"
                        )}
                      </Button>
                      <Button
                        colorScheme="gray"
                        variant="outline"
                        isLoading={isReducing}
                        flex="1"
                        minW="150px"
                        onClick={() => handleExpireAction("reduce_expire")}
                      >
                        {t(
                          "filters.advancedActions.expireSection.removeButton",
                          "Subtract days from all users"
                        )}
                      </Button>
                    </HStack>
                  </Stack>
                </Box>

                <Box borderWidth="1px" borderRadius="md" px={4} py={4}>
                  <Stack spacing={2}>
                    <Text fontWeight="semibold">
                      {t(
                        "filters.advancedActions.trafficSection.title",
                        "Usage and traffic"
                      )}
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      {t(
                        "filters.advancedActions.trafficSection.description",
                        "Apply a traffic adjustment to all users."
                      )}
                    </Text>
                    <FormControl>
                      <FormLabel>
                        {t("filters.advancedActions.trafficSection.inputLabel", "Gigabytes")}
                      </FormLabel>
                      <NumberInput
                        value={trafficGb}
                        onChange={setTrafficGb}
                        min={0.01}
                        step={0.1}
                        w="full"
                      >
                        <NumberInputField />
                      </NumberInput>
                    </FormControl>
                    <HStack spacing={2} flexWrap="wrap">
                      <Button
                        colorScheme="primary"
                        isLoading={isIncreasingTraffic}
                        flex="1"
                        minW="150px"
                        onClick={() => handleTrafficAction("increase_traffic")}
                      >
                        {t(
                          "filters.advancedActions.trafficSection.addButton",
                          "Add traffic to all users"
                        )}
                      </Button>
                      <Button
                        colorScheme="gray"
                        variant="outline"
                        isLoading={isDecreasingTraffic}
                        flex="1"
                        minW="150px"
                        onClick={() => handleTrafficAction("decrease_traffic")}
                      >
                        {t(
                          "filters.advancedActions.trafficSection.removeButton",
                          "Subtract traffic from all users"
                        )}
                      </Button>
                    </HStack>
                  </Stack>
                </Box>

                <Box borderWidth="1px" borderRadius="md" px={4} py={4}>
                  <Stack spacing={2}>
                    <Text fontWeight="semibold">
                      {t(
                        "filters.advancedActions.cleanupSection.title",
                        "Cleanup expired or limited"
                      )}
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      {t(
                        "filters.advancedActions.cleanupSection.description",
                        "Remove users that have been expired/limited for the selected number of days."
                      )}
                    </Text>
                    <FormControl>
                      <FormLabel>
                        {t(
                          "filters.advancedActions.cleanupSection.daysLabel",
                          "Days since status change"
                        )}
                      </FormLabel>
                      <NumberInput
                        value={cleanupDays}
                        onChange={setCleanupDays}
                        min={1}
                        step={1}
                        w="full"
                      >
                        <NumberInputField />
                      </NumberInput>
                    </FormControl>
                    <HStack spacing={3}>
                      {cleanupOptions.map((status) => (
                        <Checkbox
                          key={status}
                          isChecked={selectedStatuses.includes(status)}
                          onChange={() => toggleStatus(status)}
                        >
                          {t(
                            `filters.advancedActions.cleanupSection.statuses.${status}`,
                            status.charAt(0).toUpperCase() + status.slice(1)
                          )}
                        </Checkbox>
                      ))}
                    </HStack>
                    <Button
                      colorScheme="primary"
                      isLoading={isCleaning}
                      w="full"
                      onClick={handleCleanup}
                    >
                      {t(
                        "filters.advancedActions.cleanupSection.button",
                        "Delete selected users"
                      )}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={onClose}>
              {t("filters.advancedActions.close", "Close")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default AdvancedUserActions;
