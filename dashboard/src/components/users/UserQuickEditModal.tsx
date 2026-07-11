import {
	Button,
	FormControl,
	FormLabel,
	InputGroup,
	InputRightAddon,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { NumericInput } from "components/common/NumericInput";
import { DateTimePicker } from "components/DateTimePicker";
import { useDashboard } from "contexts/DashboardContext";
import dayjs from "dayjs";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Lightweight single-field editor for a user's data limit or expiry date,
 * driven by the `quickEditUser` store slot. These map onto the same
 * PUT /v2/users/{username} contract the edit dialog uses, exposed as quick
 * one-off actions from the Users overflow menu.
 */
export const UserQuickEditModal: FC = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { quickEditUser, refetchUsers } = useDashboard();
	const user = quickEditUser?.user ?? null;
	const field = quickEditUser?.field ?? null;

	const [loading, setLoading] = useState(false);
	const [limitGb, setLimitGb] = useState("");
	const [expireDate, setExpireDate] = useState<Date | null>(null);

	// Seed the input from the user's current value each time the modal opens.
	useEffect(() => {
		if (!quickEditUser) return;
		if (quickEditUser.field === "data_limit") {
			const bytes = quickEditUser.user.data_limit ?? 0;
			setLimitGb(bytes ? String(+(bytes / BYTES_PER_GB).toFixed(2)) : "");
		} else {
			const expire = quickEditUser.user.expire;
			setExpireDate(expire ? dayjs.unix(expire).toDate() : null);
		}
	}, [quickEditUser]);

	const onClose = () => {
		if (loading) return;
		useDashboard.setState({ quickEditUser: null });
	};

	const save = async () => {
		if (!user || !field) return;
		const body =
			field === "data_limit"
				? {
						data_limit: Math.max(0, Math.round(Number(limitGb) * BYTES_PER_GB)),
					}
				: { expire: expireDate ? dayjs(expireDate).unix() : null };

		setLoading(true);
		try {
			await fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
				method: "PUT",
				body,
			});
			toast({
				title:
					field === "data_limit"
						? t("usersTable.setDataLimitSuccess", "Data limit updated")
						: t("usersTable.setExpirySuccess", "Expiry date updated"),
				status: "success",
				isClosable: true,
				position: "top",
				duration: 2500,
			});
			refetchUsers(true);
			useDashboard.setState({ quickEditUser: null });
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
		} finally {
			setLoading(false);
		}
	};

	const isDataLimit = field === "data_limit";

	return (
		<Modal
			isCentered
			isOpen={Boolean(quickEditUser)}
			onClose={onClose}
			size="sm"
		>
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3">
				<ModalHeader>
					{isDataLimit
						? t("usersTable.setDataLimit", "Set data limit")
						: t("usersTable.setExpiry", "Set custom expiry")}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<VStack align="stretch" spacing={3}>
						{user && (
							<Text fontSize="sm" color="panel.textMuted" dir="ltr">
								{user.username}
							</Text>
						)}
						{isDataLimit ? (
							<FormControl>
								<FormLabel>{t("userDialog.dataLimit", "Data limit")}</FormLabel>
								<InputGroup>
									<NumericInput
										min={0}
										step={1}
										value={limitGb}
										onChange={(valueAsString) => setLimitGb(valueAsString)}
									/>
									<InputRightAddon>GB</InputRightAddon>
								</InputGroup>
								<Text fontSize="xs" color="panel.textMuted" mt={1}>
									{t("usersTable.unlimitedHint", "Set 0 for unlimited.")}
								</Text>
							</FormControl>
						) : (
							<FormControl>
								<FormLabel>{t("usersTable.expire", "Expire")}</FormLabel>
								<DateTimePicker
									value={expireDate}
									onChange={setExpireDate}
									minDate={new Date()}
									placeholder={t("usersTable.setExpiry", "Set custom expiry")}
								/>
								<Text fontSize="xs" color="panel.textMuted" mt={1}>
									{t(
										"usersTable.expiryClearHint",
										"Leave empty for no expiry.",
									)}
								</Text>
							</FormControl>
						)}
					</VStack>
				</ModalBody>
				<ModalFooter gap={3}>
					<Button
						size="sm"
						variant="outline"
						onClick={onClose}
						isDisabled={loading}
					>
						{t("cancel", "Cancel")}
					</Button>
					<Button
						size="sm"
						colorScheme="primary"
						onClick={save}
						isLoading={loading}
					>
						{t("save", "Save")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
