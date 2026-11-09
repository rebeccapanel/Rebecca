import {
	Alert,
	AlertIcon,
	Box,
	HStack,
	Stack,
	Tag,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { Link } from "react-router-dom";
import { fetch, getAPIErrorMessage } from "service/http";
import {
	diagnosticHref,
	diagnosticSeverity,
	isCriticalDiagnostic,
	type Diagnostic,
} from "utils/diagnostics";

export const useSystemDiagnostics = (enabled: boolean) =>
	useQuery<Diagnostic[]>(
		["system-diagnostics"],
		() => fetch("/system/diagnostics"),
		{ enabled, refetchInterval: 15000, staleTime: 10000, retry: false },
	);

export const SystemDiagnostics = ({
	issues,
	error,
	criticalOnly = false,
}: {
	issues: Diagnostic[];
	error?: unknown;
	criticalOnly?: boolean;
}) => {
	const { t } = useTranslation();
	const warningBg = useColorModeValue(
		"rgba(245, 158, 11, 0.05)",
		"rgba(245, 158, 11, 0.1)",
	);
	const warningBorder = useColorModeValue(
		"rgba(245, 158, 11, 0.22)",
		"rgba(245, 158, 11, 0.32)",
	);
	const warningHoverBorder = useColorModeValue(
		"rgba(245, 158, 11, 0.4)",
		"rgba(245, 158, 11, 0.55)",
	);
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

	const visibleIssues = criticalOnly
		? issues.filter(isCriticalDiagnostic)
		: issues;
	if (!visibleIssues.length && !error) return null;
	return (
		<Stack spacing={3} role="alert" aria-live="polite">
			<Text
				fontWeight="700"
				fontSize="13px"
				color={criticalOnly ? "red.400" : "panel.textSecondary"}
				letterSpacing="0.02em"
			>
				{t(criticalOnly ? "diagnostics.criticalTitle" : "diagnostics.title")} (
				{visibleIssues.length})
			</Text>
			{Boolean(error) && (
				<Alert
					status="error"
					borderRadius="14px"
					borderWidth="1px"
					bg={errorBg}
					borderColor={errorBorder}
				>
					<AlertIcon />
					<Text fontSize="13px">{getAPIErrorMessage(error)}</Text>
				</Alert>
			)}
			{visibleIssues.map((issue, index) => {
				const isWarning = diagnosticSeverity(issue) === "warning";
				return (
					<Alert
						as={Link}
						to={diagnosticHref(issue)}
						role="link"
						aria-label={`${issue.resource}: ${issue.message}`}
						key={`${issue.target_id}-${issue.resource_type}-${index}`}
						status={isWarning ? "warning" : "error"}
						borderRadius="14px"
						borderWidth="1px"
						bg={isWarning ? warningBg : errorBg}
						borderColor={isWarning ? warningBorder : errorBorder}
						alignItems="flex-start"
						textDecoration="none"
						p={{ base: 3.5, md: 4 }}
						transition="all 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
						_hover={{
							md: {
								textDecoration: "none",
								borderColor: isWarning ? warningHoverBorder : errorHoverBorder,
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
						<Box minW={0} flex={1}>
							<HStack flexWrap="wrap" spacing={2} mb={2}>
								<Tag
									colorScheme={isWarning ? "orange" : "red"}
									size="sm"
									borderRadius="6px"
									fontWeight="600"
									fontSize="11px"
									px={2}
									py={0.5}
								>
									{t(`diagnostics.level.${diagnosticSeverity(issue)}`)}
								</Tag>
								<Tag
									colorScheme={isWarning ? "orange" : "red"}
									size="sm"
									borderRadius="6px"
									fontWeight="600"
									fontSize="11px"
									px={2}
									py={0.5}
								>
									{t(
										`diagnostics.source.${issue.resource_type}`,
										issue.resource_type,
									)}
								</Tag>
								<Text fontWeight="600" fontSize="13px" color="panel.text">
									{issue.resource}
								</Text>
								<Text
									fontSize="11px"
									dir="ltr"
									sx={{ unicodeBidi: "isolate" }}
									color="panel.textSecondary"
									fontFamily="mono"
									bg="panel.elevated"
									px={1.5}
									py={0.5}
									borderRadius="5px"
								>
									{issue.target_id}
								</Text>
								<HStack
									spacing={1}
									fontSize="12px"
									color={isWarning ? "orange.400" : "red.400"}
									ms="auto"
								>
									<Text as="span">{t("diagnostics.openSection")}</Text>
									<ArrowTopRightOnSquareIcon width={13} height={13} />
								</HStack>
							</HStack>
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
								{issue.message}
							</Text>
						</Box>
					</Alert>
				);
			})}
		</Stack>
	);
};
