import {
	Button,
	chakra,
	Divider,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Portal,
	Stack,
	Text,
	useDisclosure,
} from "@chakra-ui/react";
import {
	ArrowLeftOnRectangleIcon,
	Bars3Icon,
	CheckIcon,
	Cog6ToothIcon,
	DocumentMinusIcon,
	EllipsisVerticalIcon,
	LanguageIcon,
	LinkIcon,
	SquaresPlusIcon,
} from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import { type FC, type ReactNode, useRef } from "react";
import ReactCountryFlag from "react-country-flag";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AdminSection, UserPermissionToggle } from "types/Admin";
import { ReactComponent as ImperialIranFlag } from "../assets/imperial-iran-flag.svg";
import { GitHubStars } from "./GitHubStars";
import ThemeSelector from "./ThemeSelector";

type HeaderProps = {
	actions?: ReactNode;
};
const iconProps = {
	baseStyle: {
		w: 4,
		h: 4,
	},
};

const CoreSettingsIcon = chakra(Cog6ToothIcon, iconProps);
const SettingsIcon = chakra(Bars3Icon, iconProps);
const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const HostsIcon = chakra(LinkIcon, iconProps);
const NodesIcon = chakra(SquaresPlusIcon, iconProps);
const ResetUsageIcon = chakra(DocumentMinusIcon, iconProps);
const MoreIcon = chakra(EllipsisVerticalIcon, iconProps);
const LanguageIconStyled = chakra(LanguageIcon, iconProps);

export const Header: FC<HeaderProps> = ({ actions }) => {
	const { userData, getUserIsSuccess, getUserIsPending } = useGetUser();
	const { t, i18n } = useTranslation();
	const actionsContentRef = useRef<HTMLDivElement | null>(null);

	const sectionAccess = userData.permissions?.sections;
	const canAccessHosts = Boolean(sectionAccess?.[AdminSection.Hosts]);
	const canAccessNodes = Boolean(sectionAccess?.[AdminSection.Nodes]);
	const canResetAllUsage = Boolean(
		userData.permissions?.users?.[UserPermissionToggle.ResetUsage],
	);
	const canOpenCoreSettings = Boolean(
		sectionAccess?.[AdminSection.Integrations] ||
			sectionAccess?.[AdminSection.Xray],
	);
	const hasSettingsActions =
		canAccessHosts || canAccessNodes || canResetAllUsage;

	const { onResetAllUsage, onEditingNodes } = useDashboard();
	const actionsMenu = useDisclosure();

	const languageItems = [
		{ code: "en", label: "English", flag: "US" },
		{ code: "fa", label: "پارسی", flag: "IR" },
		{ code: "zh-cn", label: "中文", flag: "CN" },
		{ code: "ru", label: "Русский", flag: "RU" },
	];

	const changeLanguage = (lang: string) => {
		i18n.changeLanguage(lang);
	};

	return (
		<HStack
			gap={2}
			justifyContent="space-between"
			__css={{
				"& .menuList": {
					direction: "ltr",
				},
			}}
			position="relative"
		>
			<Text as="h1" fontWeight="semibold" fontSize="2xl">
				{t("users")}
			</Text>
			<HStack
				alignItems="center"
				spacing={3}
				flexWrap="wrap"
				justifyContent="flex-end"
			>
				{actions}

				<Menu>
					<MenuButton
						as={IconButton}
						size="sm"
						variant="outline"
						icon={<SettingsIcon />}
						position="relative"
					/>
					<MenuList minW="170px" zIndex={99999} className="menuList">
						{hasSettingsActions && (
							<>
								{canAccessHosts && (
									<MenuItem
										maxW="170px"
										fontSize="sm"
										icon={<HostsIcon />}
										as={Link}
										to="/hosts"
									>
										{t("header.hostSettings")}
									</MenuItem>
								)}
								{canAccessNodes && (
									<MenuItem
										maxW="170px"
										fontSize="sm"
										icon={<NodesIcon />}
										onClick={onEditingNodes.bind(null, true)}
									>
										{t("header.nodeSettings")}
									</MenuItem>
								)}
								{canResetAllUsage && (
									<MenuItem
										maxW="170px"
										fontSize="sm"
										icon={<ResetUsageIcon />}
										onClick={onResetAllUsage.bind(null, true)}
									>
										{t("resetAllUsage")}
									</MenuItem>
								)}
							</>
						)}
					</MenuList>
				</Menu>

				{(canOpenCoreSettings || canAccessHosts || canAccessNodes) && (
					<IconButton
						size="sm"
						variant="outline"
						aria-label="core settings"
						onClick={() => {
							useDashboard.setState({ isEditingCore: true });
						}}
					>
						<CoreSettingsIcon />
					</IconButton>
				)}

				<GitHubStars />

				<Popover
					isOpen={actionsMenu.isOpen}
					onOpen={actionsMenu.onOpen}
					onClose={actionsMenu.onClose}
					placement="bottom-end"
				>
					<PopoverTrigger>
						<IconButton
							size="sm"
							variant="outline"
							icon={<MoreIcon />}
							aria-label="more options"
							onClick={() =>
								actionsMenu.isOpen
									? actionsMenu.onClose()
									: actionsMenu.onOpen()
							}
						/>
					</PopoverTrigger>
					<Portal>
						<PopoverContent
							ref={actionsContentRef}
							w={{ base: "90vw", sm: "56" }}
						>
							<PopoverArrow />
							<PopoverBody>
								<Stack spacing={2}>
									<Menu placement="left-start">
										<MenuButton
											as={Button}
											justifyContent="space-between"
											rightIcon={<LanguageIconStyled />}
											variant="ghost"
										>
											{t("header.language", "Language")}
										</MenuButton>
										<Portal containerRef={actionsContentRef}>
											<MenuList minW={{ base: "100%", sm: "200px" }}>
												{languageItems.map(({ code, label, flag }) => {
													const isActiveLang = i18n.language === code;
													return (
														<MenuItem
															key={code}
															onClick={() => {
																changeLanguage(code);
																actionsMenu.onClose();
															}}
														>
															<HStack justify="space-between" w="full">
																<HStack spacing={2}>
																	{code === "fa" ? (
																		<ImperialIranFlag
																			style={{ width: "16px", height: "12px" }}
																		/>
																	) : (
																		<ReactCountryFlag
																			countryCode={flag}
																			svg
																			style={{ width: "16px", height: "12px" }}
																		/>
																	)}
																	<Text>{label}</Text>
																</HStack>
																{isActiveLang && <CheckIcon width={16} />}
															</HStack>
														</MenuItem>
													);
												})}
											</MenuList>
										</Portal>
									</Menu>
									<Divider />
									<ThemeSelector
										trigger="menu"
										triggerLabel={t("header.theme", "Theme")}
										portalContainer={actionsContentRef}
									/>
									<Divider />
									<Button
										colorScheme="red"
										leftIcon={<LogoutIcon />}
										justifyContent="flex-start"
										as={Link}
										to="/login"
										onClick={actionsMenu.onClose}
									>
										{t("header.logout")}
									</Button>
								</Stack>
							</PopoverBody>
						</PopoverContent>
					</Portal>
				</Popover>
			</HStack>
		</HStack>
	);
};
