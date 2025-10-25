import {
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Switch,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeSlashIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useAdminsStore } from "contexts/AdminsContext";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { AdminCreatePayload, AdminUpdatePayload } from "types/Admin";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { z } from "zod";

type AdminFormValues = {
  username: string;
  password?: string;
  telegram_id?: string;
  is_sudo?: boolean;
  data_limit?: string;
  users_limit?: string;
};

export const AdminDialog: FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    adminInDialog: admin,
    isAdminDialogOpen: isOpen,
    closeAdminDialog,
    createAdmin,
    updateAdmin,
  } = useAdminsStore();

  const mode = useMemo(() => (admin ? "edit" : "create"), [admin]);

  const schema = useMemo(() => {
    const base = z
      .object({
        username: mode === "create" ? z
          .string()
          .trim()
          .min(3, { message: t("admins.validation.usernameMin") }) : z.string().optional(),
        password: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" ? undefined : value))
          .refine(
            (value) => !value || value.length >= 6,
            t("admins.validation.passwordMin")
          ),
        telegram_id: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" ? undefined : value))
          .refine(
            (value) => value === undefined || /^\d+$/.test(value),
            t("admins.validation.telegramNumeric")
          ),
        is_sudo: z.boolean().optional(),
        data_limit: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" ? undefined : value))
          .refine(
            (value) => value === undefined || /^\d+$/.test(value),
            t("admins.validation.dataLimitNumeric", "Data limit must be a number")
          ),
        users_limit: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" ? undefined : value))
          .refine(
            (value) => value === undefined || /^\d+$/.test(value),
            t("admins.validation.usersLimitNumeric", "Users limit must be a number")
          ),
      })
      .superRefine((values, ctx) => {
        if (mode === "create" && !values.password) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["password"],
            message: t("admins.validation.passwordRequired"),
          });
        }
      });
    return base as z.ZodType<AdminFormValues>;
  }, [mode, t]);

  const form = useForm<AdminFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      password: "",
      telegram_id: "",
      is_sudo: false,
      data_limit: "",
      users_limit: "",
    },
  });

  const { register, handleSubmit, reset, formState, setValue, watch } = form;

  const sudoField = register("is_sudo");
  const [showPassword, setShowPassword] = useState(false);

  const generateRandomString = useCallback((length: number) => {
    const characters =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const charactersLength = characters.length;

    if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
      const randomValues = new Uint32Array(length);
      window.crypto.getRandomValues(randomValues);
      return Array.from(randomValues, (value) =>
        characters[value % charactersLength]
      ).join("");
    }

    return Array.from({ length }, () => {
      const index = Math.floor(Math.random() * charactersLength);
      return characters[index];
    }).join("");
  }, []);

  const handleGenerateUsername = useCallback(() => {
    if (mode === "edit") return;
    const randomUsername = generateRandomString(8);
    setValue("username", randomUsername, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [generateRandomString, mode, setValue]);

  const handleGeneratePassword = useCallback(() => {
    const randomPassword = generateRandomString(12);
    setValue("password", randomPassword, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [generateRandomString, setValue]);
  const { errors, isSubmitting } = formState;

  useEffect(() => {
    if (isOpen) {
      reset({
        username: admin?.username ?? "",
        password: "",
        telegram_id:
          admin?.telegram_id !== undefined && admin?.telegram_id !== null
            ? String(admin.telegram_id)
            : "",
        is_sudo: admin?.is_sudo ?? false,
        data_limit:
          admin?.data_limit !== undefined && admin?.data_limit !== null
            ? String(Math.floor(admin.data_limit / (1024 * 1024 * 1024)))
            : "",
        users_limit:
          admin?.users_limit !== undefined && admin?.users_limit !== null
            ? String(admin.users_limit)
            : "",
      });
    }
  }, [admin, isOpen, reset]);

  const handleFormSubmit = handleSubmit(async (values) => {
    try {
      if (mode === "create") {
        const payload: AdminCreatePayload = {
          username: values.username.trim(),
          password: values.password ?? "",
          is_sudo: values.is_sudo ?? false,
          telegram_id: values.telegram_id
            ? Number(values.telegram_id)
            : undefined,
          data_limit: values.data_limit
            ? Number(values.data_limit) * 1024 * 1024 * 1024
            : undefined,
          users_limit: values.users_limit
            ? Number(values.users_limit)
            : undefined,
        };
        await createAdmin(payload);
        generateSuccessMessage(t("admins.createSuccess", "Admin created"), toast);
      } else if (admin) {
        const payload: AdminUpdatePayload = {
          is_sudo: values.is_sudo ?? false,
          telegram_id: values.telegram_id
            ? Number(values.telegram_id)
            : undefined,
          data_limit: values.data_limit
            ? Number(values.data_limit) * 1024 * 1024 * 1024
            : undefined,
          users_limit: values.users_limit
            ? Number(values.users_limit)
            : undefined,
        };
        if (values.password) {
          payload.password = values.password;
        }
        await updateAdmin(admin.username, payload);
        generateSuccessMessage(t("admins.updateSuccess", "Admin updated"), toast);
      }
      closeAdminDialog();
    } catch (error) {
      generateErrorMessage(error, toast, form);
    }
  });

  return (
    <Modal isOpen={isOpen} onClose={closeAdminDialog} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          {mode === "create"
            ? t("admins.addAdminTitle", "Add admin")
            : t("admins.editAdminTitle", "Edit admin")}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            <FormControl isInvalid={!!errors.username}>
              <FormLabel>{t("username")}</FormLabel>
              <InputGroup>
                <Input
                  placeholder={t(
                    "admins.usernamePlaceholder",
                    "Admin username"
                  )}
                  {...register("username")}
                  isDisabled={mode === "edit"}
                />
                {mode === "create" && (
                  <InputRightElement>
                    <IconButton
                      aria-label={t("admins.generateUsername", "Random")}
                      size="sm"
                      variant="ghost"
                      icon={<SparklesIcon width={20} />}
                      onClick={handleGenerateUsername}
                    />
                  </InputRightElement>
                )}
              </InputGroup>
              <FormErrorMessage>
                {errors.username?.message as string}
              </FormErrorMessage>
            </FormControl>
            <FormControl isInvalid={!!errors.password}>
              <FormLabel>{t("password")}</FormLabel>
              <HStack spacing={2}>
                <InputGroup>
                  <Input
                    placeholder={t("admins.passwordPlaceholder", "Password")}
                    type={showPassword ? "text" : "password"}
                    {...register("password")}
                  />
                  <InputRightElement>
                    <IconButton
                      aria-label={
                        showPassword
                          ? t("admins.hidePassword", "Hide")
                          : t("admins.showPassword", "Show")
                      }
                      size="sm"
                      variant="ghost"
                      icon={
                        showPassword ? (
                          <EyeSlashIcon width={16} />
                        ) : (
                          <EyeIcon width={16} />
                        )
                      }
                      onClick={() => setShowPassword(!showPassword)}
                    />
                  </InputRightElement>
                </InputGroup>
                <IconButton
                  aria-label={t("admins.generatePassword", "Random")}
                  size="md"
                  variant="outline"
                  icon={<SparklesIcon width={20} />}
                  onClick={handleGeneratePassword}
                />
              </HStack>
              <FormErrorMessage>
                {errors.password?.message as string}
              </FormErrorMessage>
              {mode === "edit" && (
                <Text fontSize="xs" color="gray.500" mt={1}>
                  {t(
                    "admins.passwordOptionalHint",
                    "Leave empty to keep current password."
                  )}
                </Text>
              )}
            </FormControl>
            <FormControl display="flex" alignItems="center">
              <VStack align="start" spacing={1} w="full">
                <HStack justify="space-between" w="full">
                  <FormLabel htmlFor="is_sudo" mb="0">
                    {t("admins.sudoAccess", "Sudo access")}
                  </FormLabel>
                  <Switch
                    id="is_sudo"
                    isChecked={watch("is_sudo")}
                    onChange={(event) =>
                      setValue("is_sudo", event.target.checked, {
                        shouldDirty: true,
                      })
                    }
                    onBlur={sudoField.onBlur}
                    ref={sudoField.ref}
                  />
                </HStack>
                <Text fontSize="xs" color="gray.500">
                  {t(
                    "admins.sudoDescription",
                    "Sudo admins can manage other admins."
                  )}
                </Text>
              </VStack>
            </FormControl>
            <FormControl isInvalid={!!errors.telegram_id}>
              <FormLabel>{t("admins.telegramId", "Telegram ID")}</FormLabel>
              <Input
                placeholder={t(
                  "admins.telegramPlaceholder",
                  "Optional numeric Telegram ID"
                )}
                inputMode="numeric"
                {...register("telegram_id")}
              />
              <FormErrorMessage>
                {errors.telegram_id?.message as string}
              </FormErrorMessage>
            </FormControl>
            <FormControl isInvalid={!!errors.data_limit}>
              <FormLabel>{t("admins.dataLimit", "Data Limit (GB)")}</FormLabel>
              <Input
                placeholder={t(
                  "admins.dataLimitPlaceholder",
                  "e.g., 100 for 100GB (empty = unlimited)"
                )}
                inputMode="numeric"
                {...register("data_limit")}
              />
              <FormErrorMessage>
                {errors.data_limit?.message as string}
              </FormErrorMessage>
              <Text fontSize="xs" color="gray.500" mt={1}>
                {t("admins.dataLimitHint", "Leave empty for unlimited data")}
              </Text>
            </FormControl>
            <FormControl isInvalid={!!errors.users_limit}>
              <FormLabel>{t("admins.usersLimit", "Users Limit")}</FormLabel>
              <Input
                placeholder={t(
                  "admins.usersLimitPlaceholder",
                  "e.g., 100 (empty = unlimited)"
                )}
                inputMode="numeric"
                {...register("users_limit")}
              />
              <FormErrorMessage>
                {errors.users_limit?.message as string}
              </FormErrorMessage>
              <Text fontSize="xs" color="gray.500" mt={1}>
                {t("admins.usersLimitHint", "Leave empty for unlimited users")}
              </Text>
            </FormControl>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack spacing={3}>
            <Button variant="ghost" onClick={closeAdminDialog}>
              {t("cancel")}
            </Button>
            <Button
              colorScheme="primary"
              onClick={handleFormSubmit}
              isLoading={isSubmitting}
            >
              {mode === "create"
                ? t("admins.addAdmin", "Create")
                : t("save", "Save")}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};