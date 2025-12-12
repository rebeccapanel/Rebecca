import {
	Alert,
	AlertDescription,
	AlertIcon,
	Button,
	Checkbox,
	FormControl,
	FormLabel,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	Spinner,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { fetch as apiFetch } from "service/http";

type CoreVersionDialogProps = {
	isOpen: boolean;
	title: string;
	description?: string;
	currentVersion?: string | null;
	allowPersist?: boolean;
	isSubmitting?: boolean;
	onSubmit: (payload: { version: string; persist?: boolean }) => Promise<void>;
	onClose: () => void;
};

const RELEASE_LIMIT = 10;

export const CoreVersionDialog = ({
	isOpen,
	title,
	description,
	currentVersion,
	allowPersist = false,
	isSubmitting,
	onSubmit,
	onClose,
}: CoreVersionDialogProps) => {
	const { t } = useTranslation();
	const [version, setVersion] = useState("");
	const [persist, setPersist] = useState(false);
	const [submissionError, setSubmissionError] = useState<string | null>(null);

	const releasesQuery = useQuery(
		["core-xray-releases"],
		() =>
			apiFetch<{ tags: string[] }>("/core/xray/releases", {
				query: { limit: RELEASE_LIMIT },
			}),
		{
			enabled: isOpen,
			staleTime: 5 * 60 * 1000,
		},
	);

	useEffect(() => {
		if (isOpen) {
			setVersion(currentVersion || "");
			setPersist(false);
			setSubmissionError(null);
		}
	}, [isOpen, currentVersion]);

	const releaseOptions = useMemo(
		() => releasesQuery.data?.tags ?? [],
		[releasesQuery.data],
	);

	const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		setVersion(event.target.value);
	};

	const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setVersion(event.target.value);
	};

	const handleSubmit = async () => {
		if (!version) {
			setSubmissionError(t("validation.required"));
			return;
		}
		try {
			setSubmissionError(null);
			await onSubmit({ version, persist: allowPersist ? persist : undefined });
		} catch (err) {
			if (err instanceof Error) {
				setSubmissionError(err.message);
			} else {
				setSubmissionError(t("core.generalErrorMessage"));
			}
		}
	};

	const isLoadingReleases = releasesQuery.isLoading;

	return (
		<Modal isOpen={isOpen} onClose={onClose} isCentered size="lg">
			<ModalOverlay />
			<ModalContent>
				<ModalHeader>{title}</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<Stack spacing={4}>
						{description && (
							<Text
								fontSize="sm"
								color="gray.600"
								_dark={{ color: "gray.300" }}
							>
								{description}
							</Text>
						)}
						<FormControl>
							<FormLabel>
								{t("nodes.coreVersionDialog.latestReleases")}
							</FormLabel>
							<Select
								placeholder={
									isLoadingReleases
										? t("nodes.coreVersionDialog.loadingReleases")
										: t("nodes.coreVersionDialog.selectVersionPlaceholder")
								}
								value={
									version && releaseOptions.includes(version) ? version : ""
								}
								onChange={handleSelectChange}
								isDisabled={isLoadingReleases || releaseOptions.length === 0}
								size="sm"
							>
								{releaseOptions.map((item) => (
									<option key={item} value={item}>
										{item}
									</option>
								))}
							</Select>
							{isLoadingReleases && (
								<Stack direction="row" align="center" spacing={2} mt={2}>
									<Spinner size="sm" />
									<Text
										fontSize="xs"
										color="gray.500"
										_dark={{ color: "gray.400" }}
									>
										{t("nodes.coreVersionDialog.fetchingFromGithub")}
									</Text>
								</Stack>
							)}
							{releasesQuery.isError && (
								<Text fontSize="xs" color="red.500" mt={1}>
									{t("nodes.coreVersionDialog.failedToLoadReleases")}
								</Text>
							)}
						</FormControl>
						<FormControl isRequired>
							<FormLabel>
								{t("nodes.coreVersionDialog.customVersionLabel")}
							</FormLabel>
							<Input
								value={version}
								placeholder={t(
									"nodes.coreVersionDialog.customVersionPlaceholder",
								)}
								onChange={handleInputChange}
								size="sm"
							/>
							<Text
								fontSize="xs"
								color="gray.500"
								_dark={{ color: "gray.400" }}
								mt={1}
							>
								{t("nodes.coreVersionDialog.customVersionHelper")}
							</Text>
						</FormControl>
						{allowPersist && (
							<Checkbox
								isChecked={persist}
								onChange={(event) => setPersist(event.target.checked)}
							>
								{t("nodes.coreVersionDialog.persistExecutable")}
							</Checkbox>
						)}
						{submissionError && (
							<Alert status="error" borderRadius="md" fontSize="sm">
								<AlertIcon />
								<AlertDescription>{submissionError}</AlertDescription>
							</Alert>
						)}
					</Stack>
				</ModalBody>
				<ModalFooter>
					<Button variant="ghost" mr={3} onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button
						colorScheme="primary"
						onClick={handleSubmit}
						isLoading={isSubmitting}
					>
						{t("nodes.coreVersionDialog.confirmUpdate")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

export default CoreVersionDialog;
