import {
	Badge,
	Box,
	Button,
	chakra,
	Flex,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuList,
	Portal,
	Stack,
	Text,
	VStack,
	useDisclosure,
	type PlacementWithLogical,
} from "@chakra-ui/react";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	BellIcon,
	EnvelopeOpenIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import { AnimatePresence, motion } from "framer-motion";
import {
	createContext,
	type FC,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router-dom";
import { getNotifications, markNotificationsRead } from "service/notifications";
import type { NotificationItem } from "types/Notification";

const BellIconStyled = chakra(BellIcon, { baseStyle: { w: 4, h: 4 } });

type NotificationContextValue = {
	unread: number;
	items: NotificationItem[];
	isOpen: boolean;
	onOpen: () => void;
	onClose: () => void;
	markAll: () => void;
	isMarkingAll: boolean;
	openItem: (item: NotificationItem) => void;
	incomingNotification: NotificationItem | null;
	dismissIncomingNotification: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const NotificationProvider: FC<{ children: ReactNode }> = ({ children }) => {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { isOpen, onOpen, onClose } = useDisclosure();
	const [incomingNotification, setIncomingNotification] =
		useState<NotificationItem | null>(null);
	const previousItemsRef = useRef<number[] | null>(null);
	const initialFetchDone = useRef(false);

	const inbox = useQuery(
		["notifications", "bell"],
		() => getNotifications({ limit: 8 }),
		{
			refetchInterval: 25000,
			refetchOnWindowFocus: true,
		},
	);

	const markAllMutation = useMutation(() => markNotificationsRead({ all: true }), {
		onSuccess: () => queryClient.invalidateQueries("notifications"),
	});

	const markOneMutation = useMutation(
		(id: number) => markNotificationsRead({ ids: [id] }),
		{
			onSuccess: () => queryClient.invalidateQueries("notifications"),
		},
	);

	const unread = inbox.data?.unread ?? 0;
	const items = inbox.data?.items ?? [];

	useEffect(() => {
		if (!inbox.data) return;

		const currentIds = items.map((i) => i.id);

		if (!initialFetchDone.current) {
			initialFetchDone.current = true;
			previousItemsRef.current = currentIds;
			return;
		}

		if (previousItemsRef.current) {
			const previousIds = new Set(previousItemsRef.current);
			const newItems = items.filter(
				(i) => !previousIds.has(i.id) && i.read_at === null,
			);
			if (newItems.length > 0) {
				setIncomingNotification(newItems[0]);
			}
		}

		previousItemsRef.current = currentIds;
	}, [inbox.data, items]);

	useEffect(() => {
		if (!incomingNotification) return;
		const timer = setTimeout(() => {
			setIncomingNotification(null);
		}, 7000);
		return () => clearTimeout(timer);
	}, [incomingNotification]);

	const markAll = useCallback(() => {
		markAllMutation.mutate();
	}, [markAllMutation]);

	const openItem = useCallback(
		(item: NotificationItem) => {
			if (item.read_at === null) {
				markOneMutation.mutate(item.id);
			}
			onClose();
			navigate("/notifications");
		},
		[markOneMutation, navigate, onClose],
	);

	const dismissIncomingNotification = useCallback(() => {
		setIncomingNotification(null);
	}, []);

	const isRTL = i18n.dir(i18n.language) === "rtl";

	const contextValue = useMemo(
		() => ({
			unread,
			items,
			isOpen,
			onOpen,
			onClose,
			markAll,
			isMarkingAll: markAllMutation.isLoading,
			openItem,
			incomingNotification,
			dismissIncomingNotification,
		}),
		[
			unread,
			items,
			isOpen,
			onOpen,
			onClose,
			markAll,
			markAllMutation.isLoading,
			openItem,
			incomingNotification,
			dismissIncomingNotification,
		],
	);

	return (
		<NotificationContext.Provider value={contextValue}>
			{children}

			<Portal>
				<AnimatePresence>
					{incomingNotification && (
						<Box
							position="fixed"
							top="16px"
							insetInlineEnd="16px"
							zIndex={10010}
							maxW="min(380px, calc(100vw - 32px))"
							w="full"
							pointerEvents="auto"
						>
							<motion.div
								initial={{ opacity: 0, y: -16, scale: 0.96 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, y: -10, scale: 0.96 }}
								transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
							>
								<Box
									dir={isRTL ? "rtl" : "ltr"}
									p={3.5}
									borderRadius="16px"
									bg="panel.surface"
									borderWidth="1px"
									borderColor="var(--chakra-colors-accent)"
									boxShadow="0 8px 30px rgba(0, 0, 0, 0.16), 0 0 0 1px var(--chakra-colors-accent)"
									position="relative"
									overflow="hidden"
								>
									<HStack spacing={3} align="flex-start">
										<Flex
											w="34px"
											h="34px"
											borderRadius="10px"
											bg="var(--chakra-colors-accent)"
											color="white"
											align="center"
											justify="center"
											flexShrink={0}
										>
											<BellIconStyled />
										</Flex>
										<VStack align="flex-start" spacing={1} flex="1" minW="0">
											<HStack justify="space-between" w="full">
												<Text
													fontSize="13px"
													fontWeight="700"
													color="panel.text"
													noOfLines={1}
												>
													{incomingNotification.title}
												</Text>
												<IconButton
													size="xs"
													variant="ghost"
													aria-label={t("cancel")}
													icon={<XMarkIcon width={14} height={14} />}
													onClick={dismissIncomingNotification}
													borderRadius="full"
													h="22px"
													w="22px"
													minW="22px"
												/>
											</HStack>
											<Text
												fontSize="12px"
												color="panel.textSecondary"
												noOfLines={2}
												lineHeight="tall"
											>
												{incomingNotification.body}
											</Text>
											<Button
												size="xs"
												variant="ghost"
												color="var(--chakra-colors-accent)"
												fontWeight="600"
												px={0}
												h="auto"
												mt={1}
												_hover={{ md: { bg: "transparent", textDecoration: "underline" } }}
												onClick={() => {
													openItem(incomingNotification);
													dismissIncomingNotification();
												}}
											>
												{t("notifications.bell.label")}
											</Button>
										</VStack>
									</HStack>
								</Box>
							</motion.div>
						</Box>
					)}
				</AnimatePresence>
			</Portal>
		</NotificationContext.Provider>
	);
};

export const useNotificationCenter = () => {
	const context = useContext(NotificationContext);
	if (!context) {
		throw new Error("useNotificationCenter must be used within NotificationProvider");
	}
	return context;
};

export interface NotificationMenuItemProps {
	onBeforeOpen?: () => void;
	placement?: PlacementWithLogical;
	onNavigate?: () => void;
	isOpen?: boolean;
	isPressing?: boolean;
	onToggle?: () => void;
	onClose?: () => void;
}

export const NotificationMenuItem: FC<NotificationMenuItemProps> = ({
	onBeforeOpen,
	placement = "auto-start",
	onNavigate,
	isOpen: controlledIsOpen,
	isPressing = false,
	onToggle: controlledOnToggle,
	onClose: _controlledOnClose,
}) => {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const notifMenu = useDisclosure();
	const isControlled = controlledIsOpen !== undefined;
	const isMenuOpen = isControlled ? controlledIsOpen : notifMenu.isOpen;
	const { unread, items, openItem } = useNotificationCenter();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const popperModifiers = useMemo(
		() => [
			{
				name: "preventOverflow",
				options: {
					padding: 12,
					boundary: "clippingParents",
				},
			},
			{
				name: "flip",
				options: {
					fallbackPlacements: ["bottom-start", "left-start", "right-start"],
				},
			},
		],
		[],
	);

	const handleItemClick = (item: NotificationItem) => {
		notifMenu.onClose();
		if (onNavigate) onNavigate();
		openItem(item);
	};

	const handleViewAll = () => {
		notifMenu.onClose();
		if (onNavigate) onNavigate();
		navigate("/notifications");
	};

	const menuList = (
		<MenuList
			dir={isRTL ? "rtl" : "ltr"}
			data-profile-window="true"
			data-profile-submenu="true"
			data-notification-menu-list="true"
			w={{ base: "calc(100vw - 32px)", sm: "360px" }}
			maxW="380px"
			p={2}
			borderRadius="20px"
			borderWidth="1px"
			borderColor="panel.border"
			bg="panel.surface"
			boxShadow="0 20px 48px rgba(0, 0, 0, 0.35)"
			zIndex={10005}
			overflow="hidden"
			userSelect="none"
		>
			<Box p={1.5} overflowY="auto" maxH="280px" sx={{ overscrollBehavior: "contain" }}>
				{items.length === 0 ? (
					<Flex
						direction="column"
						align="center"
						justify="center"
						py={8}
						px={3}
						textAlign="center"
					>
						<Flex
							w="38px"
							h="38px"
							borderRadius="12px"
							bg="panel.elevated"
							borderWidth="1px"
							borderColor="panel.border"
							align="center"
							justify="center"
							color="panel.textMuted"
							mb={2}
						>
							<EnvelopeOpenIcon width={18} height={18} />
						</Flex>
						<Text fontSize="13px" fontWeight="600" color="panel.text">
							{t("notifications.bell.empty")}
						</Text>
					</Flex>
				) : (
					<Stack spacing={1.5}>
						{items.slice(0, 5).map((item) => {
							const isUnread = item.read_at === null;
							return (
								<Box
									key={item.id}
									as="button"
									textAlign="start"
									p={2.5}
									borderRadius="12px"
									borderWidth="1px"
									borderColor={isUnread ? "var(--chakra-colors-accent)" : "panel.border"}
									borderInlineStartWidth={isUnread ? "3px" : "1px"}
									borderInlineStartColor={
										isUnread ? "var(--chakra-colors-accent)" : "panel.border"
									}
									bg={isUnread ? "panel.elevated" : "panel.surface"}
									transition="all 0.16s ease"
									_hover={{
										md: {
											borderColor: "panel.borderStrong",
											bg: "panel.elevated",
										},
									}}
									onClick={(e: ReactMouseEvent) => {
										e.stopPropagation();
										handleItemClick(item);
									}}
								>
									<HStack justify="space-between" mb={1} align="center">
										<HStack spacing={1.5} minW={0}>
											{isUnread && (
												<Box
													w="5px"
													h="5px"
													borderRadius="full"
													bg="var(--chakra-colors-accent)"
													flexShrink={0}
												/>
											)}
											<Text
												fontSize="12px"
												fontWeight={isUnread ? "700" : "600"}
												color="panel.text"
												isTruncated
											>
												{item.title}
											</Text>
										</HStack>
										<Text
											fontSize="10px"
											color="panel.textMuted"
											flexShrink={0}
											dir="ltr"
											sx={{ unicodeBidi: "isolate", fontVariantNumeric: "tabular-nums" }}
										>
											{dayjs.unix(item.created_at).format("HH:mm · MM/DD")}
										</Text>
									</HStack>
									<Text
										fontSize="11px"
										color="panel.textSecondary"
										noOfLines={2}
										lineHeight="short"
									>
										{item.body}
									</Text>
								</Box>
							);
						})}
					</Stack>
				)}
			</Box>

			<Box p={1.5} borderTopWidth="1px" borderColor="panel.border">
				<Button
					w="full"
					size="xs"
					h="32px"
					borderRadius="10px"
					variant="outline"
					borderColor="panel.border"
					bg="panel.surface"
					color="panel.text"
					fontWeight="600"
					fontSize="12px"
					rightIcon={
						isRTL ? (
							<ArrowLeftIcon width={12} height={12} />
						) : (
							<ArrowRightIcon width={12} height={12} />
						)
					}
					_hover={{ md: { bg: "panel.elevated", borderColor: "panel.borderStrong" } }}
					_active={{ transform: "scale(0.98)" }}
					onClick={(e: ReactMouseEvent) => {
						e.stopPropagation();
						handleViewAll();
					}}
				>
					{t("notifications.bell.viewAll")}
				</Button>
			</Box>
		</MenuList>
	);

	const handleMenuClose = () => {
		if (!isControlled) {
			notifMenu.onClose();
		}
	};

	const handleToggle = () => {
		if (onBeforeOpen) onBeforeOpen();
		if (isControlled) {
			controlledOnToggle?.();
		} else {
			notifMenu.isOpen ? notifMenu.onClose() : notifMenu.onOpen();
		}
	};

	return (
		<Menu
			placement={placement}
			strategy="fixed"
			isLazy
			autoSelect={false}
			gutter={6}
			computePositionOnMount
			modifiers={popperModifiers}
			isOpen={isMenuOpen}
			onOpen={() => {
				if (!isControlled) notifMenu.onOpen();
			}}
			onClose={handleMenuClose}
			closeOnSelect={false}
			closeOnBlur={false}
		>
			<MenuButton
				as={Button}
				variant="ghost"
				data-submenu-trigger="true"
				w="full"
				h="38px"
				justifyContent="flex-start"
				fontWeight="500"
				fontSize="13px"
				borderRadius="12px"
				px={3}
				bg={isPressing || isMenuOpen ? "panel.elevated" : "transparent"}
				color="panel.text"
				transform={isPressing ? "scale(0.96)" : undefined}
				transition="all 0.12s cubic-bezier(0.2, 0, 0, 1)"
				_hover={{ md: { bg: "panel.elevated" } }}
				_active={{ bg: "panel.elevated", transform: "scale(0.96)" }}
				_focusVisible={{ bg: "panel.elevated" }}
				onClick={(e: ReactMouseEvent) => {
					e.stopPropagation();
					handleToggle();
				}}
			>
				<HStack justify="space-between" w="full" minW={0} spacing={2.5}>
					<HStack spacing={2.5} minW={0}>
						<BellIconStyled flexShrink={0} color="panel.text" />
						<Text noOfLines={1} color="panel.text">
							{t("notifications.menu")}
						</Text>
					</HStack>
					{unread > 0 ? (
						<Badge
							borderRadius="full"
							px={1.5}
							py={0.2}
							fontSize="10px"
							fontWeight="700"
							bg="var(--chakra-colors-accent)"
							color="white"
						>
							{unread}
						</Badge>
					) : null}
				</HStack>
			</MenuButton>
			<Portal>{menuList}</Portal>
		</Menu>
	);
};

export const NotificationBell: FC = () => {
	const { t } = useTranslation();
	const { unread, onOpen } = useNotificationCenter();

	return (
		<Box position="relative" display="inline-flex">
			<IconButton
				aria-label={t("notifications.bell.label")}
				icon={<BellIcon width={18} height={18} />}
				size="sm"
				variant="ghost"
				h="34px"
				w="34px"
				borderRadius={{ base: "full", md: "12px" }}
				borderWidth="1px"
				borderColor="panel.border"
				bg="panel.surface"
				color="panel.textSecondary"
				_hover={{
					md: {
						bg: "panel.elevated",
						borderColor: "panel.borderStrong",
						color: "panel.text",
					},
				}}
				_active={{ transform: "scale(0.96)" }}
				onClick={onOpen}
			/>
			{unread > 0 && (
				<Box
					position="absolute"
					top="-2px"
					insetInlineEnd="-2px"
					w="9px"
					h="9px"
					borderRadius="full"
					bg="var(--chakra-colors-accent)"
					border="2px solid var(--chakra-colors-panel-surface)"
				/>
			)}
		</Box>
	);
};
