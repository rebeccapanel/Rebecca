import {
	Alert,
	AlertIcon,
	Box,
	CloseButton,
	HStack,
	Stack,
	Tag,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useAPIRequestErrors } from "service/http";
import { requestErrorHref } from "utils/diagnostics";

export const RequestErrors = () => {
	const location = useLocation();
	const { errors, clear } = useAPIRequestErrors();
	const { t } = useTranslation();
	const errorBg = useColorModeValue(
		"rgba(239, 68, 68, 0.05)",
		"rgba(239, 68, 68, 0.1)",
	);
	const errorBorder = useColorModeValue(
		"rgba(239, 68, 68, 0.22)",
		"rgba(239, 68, 68, 0.32)",
	);
	const errorHoverBorder = useColorModeValue(
		"rgba(239, 68, 68, 0.4)",
		"rgba(239, 68, 68, 0.55)",
	);

	if (!errors.length) return null;
	return (
		<Stack spacing={2} mb={4} role="alert" aria-live="polite">
			{errors.map((item) => (
				<Box key={item.key} position="relative">
					<Alert
						as={Link}
						to={
							item.href ||
							requestErrorHref(
								item.key,
								location.pathname.replace(/\/$/, "").endsWith("/xray-settings")
									? location.search
									: "",
							)
						}
						role="link"
						aria-label={`${t("diagnostics.requestFailed")}: ${item.message}`}
						status="error"
						borderRadius="14px"
						borderWidth="1px"
						bg={errorBg}
						borderColor={errorBorder}
						alignItems="flex-start"
						textDecoration="none"
						p={{ base: 3.5, md: 4 }}
						transition="all 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
						_hover={{
							md: {
								textDecoration: "none",
								borderColor: errorHoverBorder,
								transform: "translateY(-1px)",
								boxShadow: "0 6px 20px -4px rgba(0, 0, 0, 0.08)",
							},
						}}
						_active={{ transform: "scale(0.995)" }}
						_focusVisible={{
							outline: "2px solid",
							outlineColor: "blue.400",
							outlineOffset: "2px",
						}}
					>
						<AlertIcon mt={1} />
						<Box flex={1} minW={0} pe={8}>
							<HStack justify="space-between" mb={2}>
								<HStack spacing={2}>
									<Tag
										colorScheme="red"
										size="sm"
										borderRadius="6px"
										fontWeight="600"
										fontSize="11px"
										px={2}
										py={0.5}
									>
										{t("diagnostics.level.error")}
									</Tag>
									<Text fontWeight="600" fontSize="13px" color="panel.text">
										{t("diagnostics.requestFailed")}
									</Text>
								</HStack>
								<HStack spacing={1} fontSize="12px" color="red.400">
									<Text as="span">{t("diagnostics.openSection")}</Text>
									<ArrowTopRightOnSquareIcon width={13} height={13} />
								</HStack>
							</HStack>
							<Text
								fontSize="11px"
								fontFamily="mono"
								dir="ltr"
								sx={{ unicodeBidi: "isolate" }}
								color="panel.textSecondary"
								bg="panel.elevated"
								px={1.5}
								py={0.5}
								borderRadius="5px"
								display="inline-block"
								mb={2}
							>
								{item.key}
							</Text>
							<Text
								fontSize="12px"
								fontFamily="mono"
								whiteSpace="pre-wrap"
								wordBreak="break-word"
								dir="ltr"
								sx={{ unicodeBidi: "isolate" }}
								bg="panel.elevated"
								p={2.5}
								borderRadius="8px"
								borderWidth="1px"
								borderColor="panel.border"
								color="panel.text"
							>
								{item.message}
							</Text>
						</Box>
					</Alert>
					<CloseButton
						position="absolute"
						insetEnd={2}
						top={2}
						size="sm"
						borderRadius="8px"
						aria-label={t("close")}
						_hover={{ md: { bg: "rgba(239, 68, 68, 0.15)" } }}
						onClick={() => clear(item.key)}
					/>
				</Box>
			))}
		</Stack>
	);
};
