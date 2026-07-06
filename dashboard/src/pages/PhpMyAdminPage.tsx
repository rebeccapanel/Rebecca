import {
	Box,
	Flex,
	Heading,
	Spinner,
	Stack,
	Text,
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import useGetUser from "hooks/useGetUser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import {
	getPHPMyAdminEmbedHTML,
	getPHPMyAdminStatus,
	type PHPMyAdminStatus,
} from "service/settings";
import { AdminRole } from "types/Admin";

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
	const { colorMode } = useColorMode();
	const { userData } = useGetUser();
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const [preparedTheme, setPreparedTheme] = useState<string | null>(null);
	const panelBg = useColorModeValue("panel.elevated", "panel.elevated");
	const borderColor = useColorModeValue("panel.border", "panel.border");
	const mutedColor = useColorModeValue(
		"panel.textSecondary",
		"panel.textSecondary",
	);
	const frameBg = useColorModeValue("white", "gray.950");

	const statusQuery = useQuery("phpmyadmin-status", getPHPMyAdminStatus, {
		refetchOnWindowFocus: false,
	});
	const status = statusQuery.data ?? defaultStatus;

	const phpMyAdminTheme = colorMode === "dark" ? "blueberry" : "";
	const embedQuery = useQuery(
		["phpmyadmin-embed-session", phpMyAdminTheme || "default"],
		() => getPHPMyAdminEmbedHTML(phpMyAdminTheme || undefined),
		{
			enabled: Boolean(status.enabled && status.supported && isFullAccess),
			refetchOnWindowFocus: false,
			retry: false,
			onSuccess: () => setPreparedTheme(phpMyAdminTheme || "default"),
		},
	);
	const frameReady =
		preparedTheme === (phpMyAdminTheme || "default") && embedQuery.isSuccess;

	return (
		<Stack spacing={4}>
			<Box
				bg={panelBg}
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				overflow="hidden"
				minH={{ base: "calc(100vh - 128px)", md: "calc(100vh - 112px)" }}
			>
				{statusQuery.isLoading ? (
					<Flex minH="520px" align="center" justify="center">
						<Spinner />
					</Flex>
				) : !status.supported ? (
					<VStack minH="360px" align="center" justify="center" spacing={3} p={6}>
						<Heading size="sm">
							{t("phpmyadmin.sqliteDisabled", "phpMyAdmin is unavailable")}
						</Heading>
						<Text color={mutedColor} textAlign="center">
							{t(
								"phpmyadmin.sqliteDisabled",
								"phpMyAdmin is available only for MySQL or MariaDB installations.",
							)}
						</Text>
					</VStack>
				) : !status.enabled ? (
					<VStack minH="360px" align="center" justify="center" spacing={3} p={6}>
						<Heading size="sm">
							{t("phpmyadmin.notEnabledTitle", "phpMyAdmin is disabled")}
						</Heading>
						<Text color={mutedColor} textAlign="center">
							{t(
								"phpmyadmin.notEnabledDescription",
								"Enable phpMyAdmin from Settings to load it inside this panel.",
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
				) : embedQuery.isError ? (
					<VStack minH="360px" align="center" justify="center" spacing={3} p={6}>
						<Heading size="sm">
							{t("phpmyadmin.embedFailed", "Could not open embedded phpMyAdmin")}
						</Heading>
						<Text color={mutedColor} textAlign="center">
							{String((embedQuery.error as Error)?.message || "")}
						</Text>
					</VStack>
				) : embedQuery.isLoading || !frameReady ? (
					<Flex minH="520px" align="center" justify="center">
						<Spinner />
					</Flex>
				) : (
					<Box
						as="iframe"
						title={t("phpmyadmin.title", "phpMyAdmin")}
						srcDoc={embedQuery.data}
						sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
						w="100%"
						h={{ base: "calc(100vh - 128px)", md: "calc(100vh - 112px)" }}
						minH={{ base: "520px", md: "680px" }}
						border="0"
						bg={frameBg}
					/>
				)}
			</Box>
		</Stack>
	);
};
