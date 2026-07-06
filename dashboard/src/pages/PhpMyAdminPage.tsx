import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
	Heading,
	HStack,
	Input,
	Spinner,
	Stack,
	Text,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	ArrowTopRightOnSquareIcon,
	PowerIcon,
} from "@heroicons/react/24/outline";
import useGetUser from "hooks/useGetUser";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "react-query";
import {
	disablePHPMyAdmin,
	enablePHPMyAdmin,
	getPHPMyAdminEmbedHTML,
	getPHPMyAdminStatus,
	type PHPMyAdminStatus,
} from "service/settings";
import { AdminRole } from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { PageHeader } from "../components/ui";

const defaultStatus: PHPMyAdminStatus = {
	enabled: false,
	supported: false,
	database: "",
	port: 8080,
	path: "/phpmyadmin/",
	public_url: "",
	external_url: "",
	embed_url: "/api/settings/phpmyadmin/embed-html",
};

export const PhpMyAdminPage = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { userData } = useGetUser();
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const [port, setPort] = useState("8080");
	const [path, setPath] = useState("/phpmyadmin/");
	const [embedHTML, setEmbedHTML] = useState("");
	const panelBg = useColorModeValue("panel.elevated", "panel.elevated");
	const borderColor = useColorModeValue("panel.border", "panel.border");
	const mutedColor = useColorModeValue("panel.textSecondary", "panel.textSecondary");
	const frameBg = useColorModeValue("white", "gray.950");

	const statusQuery = useQuery("phpmyadmin-status", getPHPMyAdminStatus, {
		refetchOnWindowFocus: false,
	});
	const status = statusQuery.data ?? defaultStatus;

	useEffect(() => {
		if (!statusQuery.data) return;
		setPort(String(statusQuery.data.port || 8080));
		setPath(statusQuery.data.path || "/phpmyadmin/");
	}, [statusQuery.data]);

	const embedQuery = useQuery("phpmyadmin-embed-html", getPHPMyAdminEmbedHTML, {
		enabled: Boolean(status.enabled && isFullAccess),
		refetchOnWindowFocus: false,
		retry: false,
		onSuccess: setEmbedHTML,
	});

	const enableMutation = useMutation(
		() =>
			enablePHPMyAdmin({
				port: Number(port) || 8080,
				path: path || "/phpmyadmin/",
			}),
		{
			onSuccess: () => {
				generateSuccessMessage(
					t("phpmyadmin.enabled", "phpMyAdmin enabled."),
					toast,
				);
				void statusQuery.refetch();
				void embedQuery.refetch();
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			},
		},
	);

	const disableMutation = useMutation(disablePHPMyAdmin, {
		onSuccess: () => {
			generateSuccessMessage(
				t("phpmyadmin.disabled", "phpMyAdmin disabled."),
				toast,
			);
			setEmbedHTML("");
			void statusQuery.refetch();
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	return (
		<Stack spacing={4}>
			<PageHeader
				title={t("phpmyadmin.title", "phpMyAdmin")}
				description={t(
					"phpmyadmin.description",
					"Install and open phpMyAdmin from inside the Rebecca panel.",
				)}
			/>
			<Box
				bg={panelBg}
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				p={{ base: 4, md: 5 }}
			>
				<Flex
					align={{ base: "stretch", md: "center" }}
					justify="space-between"
					gap={4}
					flexDirection={{ base: "column", md: "row" }}
				>
					<Box>
						<HStack spacing={2} mb={1}>
							<Heading size="sm">{t("phpmyadmin.status", "Status")}</Heading>
							<Badge colorScheme={status.enabled ? "green" : "gray"}>
								{status.enabled
									? t("phpmyadmin.enabledBadge", "Enabled")
									: t("phpmyadmin.disabledBadge", "Disabled")}
							</Badge>
							<Badge colorScheme={status.supported ? "blue" : "orange"}>
								{status.database || "-"}
							</Badge>
						</HStack>
						<Text fontSize="sm" color={mutedColor}>
							{status.supported
								? t(
										"phpmyadmin.supportedHint",
										"Available for MySQL and MariaDB binary installations.",
									)
								: t(
										"phpmyadmin.unsupportedHint",
										"phpMyAdmin is not available for SQLite installations.",
									)}
						</Text>
					</Box>
					<HStack spacing={3} flexWrap="wrap">
						<Button
							size="sm"
							variant="outline"
							leftIcon={<ArrowPathIcon width={16} height={16} />}
							onClick={() => {
								void statusQuery.refetch();
								void embedQuery.refetch();
							}}
							isLoading={statusQuery.isFetching || embedQuery.isFetching}
						>
							{t("actions.refresh")}
						</Button>
						{status.enabled && status.external_url ? (
							<Button
								as="a"
								size="sm"
								variant="outline"
								href={status.external_url}
								target="_blank"
								rel="noreferrer"
								leftIcon={<ArrowTopRightOnSquareIcon width={16} height={16} />}
							>
								{t("phpmyadmin.openExternal", "Open external link")}
							</Button>
						) : null}
					</HStack>
				</Flex>
				<Stack spacing={4} mt={5}>
					<Flex
						gap={4}
						flexDirection={{ base: "column", md: "row" }}
						align={{ base: "stretch", md: "flex-end" }}
					>
						<FormControl maxW={{ base: "full", md: "180px" }}>
							<FormLabel fontSize="sm">{t("phpmyadmin.port", "Port")}</FormLabel>
							<Input
								type="number"
								min={1}
								max={65535}
								value={port}
								onChange={(event) => setPort(event.target.value)}
								isDisabled={enableMutation.isLoading || disableMutation.isLoading}
							/>
						</FormControl>
						<FormControl>
							<FormLabel fontSize="sm">{t("phpmyadmin.path", "Path")}</FormLabel>
							<Input
								value={path}
								placeholder="/phpmyadmin/"
								onChange={(event) => setPath(event.target.value)}
								isDisabled={enableMutation.isLoading || disableMutation.isLoading}
							/>
							<FormHelperText>
								{t(
									"phpmyadmin.externalHint",
									"The external HTTP endpoint still requires phpMyAdmin login.",
								)}
							</FormHelperText>
						</FormControl>
						<Button
							colorScheme={status.enabled ? "red" : "primary"}
							leftIcon={<PowerIcon width={16} height={16} />}
							onClick={() =>
								status.enabled
									? disableMutation.mutate()
									: enableMutation.mutate()
							}
							isDisabled={!status.supported}
							isLoading={enableMutation.isLoading || disableMutation.isLoading}
						>
							{status.enabled
								? t("phpmyadmin.disableAction", "Disable")
								: t("phpmyadmin.enableAction", "Install and enable")}
						</Button>
					</Flex>
					{status.enabled && status.external_url ? (
						<Alert status="info" variant="subtle" borderRadius="md">
							<AlertIcon />
							<Text fontSize="sm">
								{t("phpmyadmin.externalURL", "External URL")}:{" "}
								<Box as="span" fontFamily="mono">
									{status.external_url}
								</Box>
							</Text>
						</Alert>
					) : null}
				</Stack>
			</Box>
			<Box
				bg={panelBg}
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				overflow="hidden"
				minH={{ base: "520px", md: "680px" }}
			>
				{statusQuery.isLoading ? (
					<Flex minH="520px" align="center" justify="center">
						<Spinner />
					</Flex>
				) : !status.enabled ? (
					<VStack minH="360px" align="center" justify="center" spacing={3} p={6}>
						<Heading size="sm">
							{t("phpmyadmin.notEnabledTitle", "phpMyAdmin is disabled")}
						</Heading>
						<Text color={mutedColor} textAlign="center">
							{t(
								"phpmyadmin.notEnabledDescription",
								"Install and enable phpMyAdmin to load it inside this panel.",
							)}
						</Text>
					</VStack>
				) : !isFullAccess ? (
					<VStack minH="360px" align="center" justify="center" spacing={3} p={6}>
						<Heading size="sm">
							{t("phpmyadmin.fullAccessOnly", "Full access required")}
						</Heading>
						<Text color={mutedColor} textAlign="center">
							{t(
								"phpmyadmin.fullAccessOnlyHint",
								"Embedded auto-login is available only for full access admins.",
							)}
						</Text>
					</VStack>
				) : embedQuery.isLoading ? (
					<Flex minH="520px" align="center" justify="center">
						<Spinner />
					</Flex>
				) : embedQuery.isError ? (
					<VStack minH="360px" align="center" justify="center" spacing={3} p={6}>
						<Heading size="sm">
							{t("phpmyadmin.embedFailed", "Could not open embedded phpMyAdmin")}
						</Heading>
						<Text color={mutedColor} textAlign="center">
							{String((embedQuery.error as Error)?.message || "")}
						</Text>
					</VStack>
				) : (
					<Box
						as="iframe"
						title={t("phpmyadmin.title", "phpMyAdmin")}
						srcDoc={embedHTML}
						w="100%"
						h={{ base: "calc(100vh - 260px)", md: "calc(100vh - 220px)" }}
						minH={{ base: "520px", md: "680px" }}
						border="0"
						bg={frameBg}
					/>
				)}
			</Box>
		</Stack>
	);
};
