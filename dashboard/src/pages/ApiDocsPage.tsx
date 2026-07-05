import {
	Button,
	Box,
	Flex,
	Heading,
	Spinner,
	Text,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type DocsStatus = "checking" | "enabled" | "disabled";

export const ApiDocsPage = () => {
	const { t } = useTranslation();
	const [status, setStatus] = useState<DocsStatus>("checking");
	const panelBg = useColorModeValue("white", "gray.950");
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const mutedColor = useColorModeValue("gray.600", "gray.400");
	const frameBg = useColorModeValue("gray.50", "blackAlpha.300");

	useEffect(() => {
		let cancelled = false;
		void fetch("/openapi.json", {
			headers: { Accept: "application/json" },
			cache: "no-store",
		})
			.then((response) => {
				if (cancelled) return;
				if (response.ok) {
					setStatus("enabled");
					return;
				}
				setStatus("disabled");
			})
			.catch(() => {
				if (!cancelled) setStatus("disabled");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (status === "checking") {
		return (
			<Flex minH="50vh" align="center" justify="center">
				<VStack spacing={3}>
					<Spinner />
					<Text color={mutedColor}>{t("apiDocs.checking", "Checking API docs...")}</Text>
				</VStack>
			</Flex>
		);
	}

	if (status === "disabled") {
		return (
			<VStack
				align="start"
				spacing={4}
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				p={{ base: 4, md: 6 }}
			>
				<Heading size="md">{t("apiDocs.disabledTitle", "API docs are disabled")}</Heading>
				<Text color={mutedColor}>
					{t(
						"apiDocs.disabledDescription",
						"Enable API docs from Settings, then restart or reload the panel.",
					)}
				</Text>
				<Button as="a" href="/docs/" variant="outline">
					{t("apiDocs.openRoute", "Open /docs")}
				</Button>
			</VStack>
		);
	}

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={panelBg}
			overflow="hidden"
			minH={{ base: "calc(100vh - 144px)", md: "calc(100vh - 116px)" }}
		>
			<Box
				as="iframe"
				title={t("apiDocs.menu", "API Docs")}
				src="/docs/"
				w="100%"
				h={{ base: "calc(100vh - 146px)", md: "calc(100vh - 118px)" }}
				minH="720px"
				border="0"
				bg={frameBg}
			/>
		</Box>
	);
};
