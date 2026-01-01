import {
	Badge,
	Box,
	Button,
	chakra,
	Divider,
	IconButton,
	HStack,
	List,
	ListIcon,
	ListItem,
	OrderedList,
	Skeleton,
	Stack,
	Table,
	TableContainer,
	Tbody,
	Td,
	Th,
	Text,
	Thead,
	Tr,
	Tag,
	SimpleGrid,
	FormControl,
	FormLabel,
	Select,
	Switch,
	NumberInput,
	NumberInputField,
	NumberInputStepper,
	NumberIncrementStepper,
	NumberDecrementStepper,
	Link,
	Input,
	InputGroup,
	InputLeftElement,
	InputRightElement,
	useColorModeValue,
	VStack,
	Flex,
	Heading,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import {
	ArrowPathIcon,
	BookOpenIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	InformationCircleIcon,
	MagnifyingGlassIcon,
	LightBulbIcon,
	QuestionMarkCircleIcon,
	SparklesIcon,
	XMarkIcon,
	ShieldCheckIcon,
	TagIcon,
	UserIcon,
} from "@heroicons/react/24/outline";
import useGetUser from "hooks/useGetUser";
import dayjs from "dayjs";
import { StatusBadge } from "components/StatusBadge";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { Status } from "types/User";

type TutorialSection = {
	id: string;
	title: string;
	description: string;
	steps?: string[];
	hints?: string[];
	subsections?: {
		id: string;
		title: string;
		description?: string;
		steps?: string[];
		hints?: string[];
		icon?: string;
		color?: string;
	}[];
};

type StatusGuide = {
	status: Status;
	title: string;
	description: string;
	actions?: string[];
};

type FaqItem = {
	id: string;
	question: string;
	answer: string;
	bullets?: string[];
};

type DialogField = {
	name: string;
	detail?: string;
	tips?: string[];
};

type DialogSection = {
	id: string;
	title: string;
	description?: string;
	fields?: DialogField[];
};

type SampleUser = {
	username: string;
	status: Status;
	expireInDays?: number | null;
	dataLimitGb?: number | null;
	usedGb?: number | null;
	ipLimit?: number | null;
	note?: string;
};

type TutorialContent = {
	meta?: { updated?: string };
	intro?: string;
	panelIntro?: {
		title: string;
		description?: string;
		bullets?: string[];
		links?: { label: string; action: "navigate" | "url"; target: string }[];
	};
	quickTips?: string[];
	sections?: (TutorialSection & { requiresRole?: ("sudo" | "full_access")[] })[];
	dialogSections?: DialogSection[];
	statuses?: StatusGuide[];
	adminRoles?: { id: string; title: string; description: string; bullets?: string[] }[];
	faqs?: FaqItem[];
	samples?: SampleUser[];
};

const iconProps = {
	baseStyle: {
		w: 5,
		h: 5,
	},
};

const SparkleIcon = chakra(SparklesIcon, iconProps);
const BookIcon = chakra(BookOpenIcon, iconProps);
const QuestionIcon = chakra(QuestionMarkCircleIcon, iconProps);
const InfoIcon = chakra(InformationCircleIcon, iconProps);
const CheckIcon = chakra(CheckCircleIcon, iconProps);
const HintIcon = chakra(LightBulbIcon, iconProps);
const RetryIcon = chakra(ArrowPathIcon, iconProps);
const SearchIcon = chakra(MagnifyingGlassIcon, iconProps);
const ClearIcon = chakra(XMarkIcon, iconProps);
const ShieldCheck = chakra(ShieldCheckIcon, iconProps);
const TagShape = chakra(TagIcon, iconProps);
const UserShape = chakra(UserIcon, iconProps);

const normalizeRole = (role?: string | null) =>
	role?.toString().toLowerCase().replace(/[^a-z]/g, "") || "";

const TutorialsPage: FC = () => {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { userData, getUserIsSuccess } = useGetUser();
	const [content, setContent] = useState<TutorialContent | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [activeId, setActiveId] = useState<string | null>(null);
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [activeTab, setActiveTab] = useState<"general" | "admin">("general");
	const [highlightId, setHighlightId] = useState<string | null>(null);
	const highlightTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const scrollKey = "tutorials-scroll";
	const savedScrollRef = useRef<number | null>(null);
	const hasRestoredScroll = useRef(false);

	const cardStyles = useMemo(
		() => ({
			borderWidth: "1px",
			borderColor: "light-border",
			borderRadius: "xl",
			bg: "surface.light",
			_dark: { bg: "surface.dark", borderColor: "whiteAlpha.200" },
			p: { base: 3, md: 4 },
		}),
		[],
	);

	const textMuted = useColorModeValue("gray.600", "gray.400");
	const errorBg = useColorModeValue("red.50", "whiteAlpha.100");
	const innerCardBg = useColorModeValue("white", "gray.900");
	const hintBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
	const menuCardBg = useColorModeValue("white", "gray.900");
	const menuBorder = useColorModeValue("light-border", "whiteAlpha.200");
	const menuActiveBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const menuHoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.200");
	const rowHoverBg = useColorModeValue("gray.50", "whiteAlpha.50");
	const pulseGlow = useMemo(
		() =>
			keyframes`
				0% { opacity: 0.9; transform: scale(1); }
				50% { opacity: 0.6; transform: scale(0.995); }
				100% { opacity: 0.9; transform: scale(1); }
			`,
		[],
	);

	const buildTutorialUrl = useCallback(() => {
		const lang = (i18n.language || "en").toLowerCase();
		const file = lang.startsWith("fa") ? "totfa.json" : "toten.json";
		const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
		return `${base}/statics/locles/${file}`;
	}, [i18n.language]);

	const fetchContent = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch(buildTutorialUrl(), {
				headers: {
					"Cache-Control": "no-cache",
				},
			});
			if (!response.ok) {
				throw new Error(`Failed to load tutorial: ${response.status}`);
			}
			const data = (await response.json()) as TutorialContent;
			setContent(data);
		} catch (err) {
			console.error("Failed to load tutorial content", err);
			setError(t("tutorials.error"));
			setContent(null);
		} finally {
			setLoading(false);
		}
	}, [buildTutorialUrl, t]);

	useEffect(() => {
		void fetchContent();
	}, [fetchContent]);

	const normalizedSearch = searchTerm.trim().toLowerCase();
	const containsTerm = (value?: string | null) => {
		if (!normalizedSearch) return true;
		if (!value) return false;
		return value.toLowerCase().includes(normalizedSearch);
	};

	const filtered = useMemo(() => {
		if (!content) {
			return {
				quickTips: [],
				sections: [],
				dialogSections: [],
				statuses: [],
				faqs: [],
				samples: [],
			};
		}

		const filterArray = <T,>(arr: T[], matcher: (item: T) => boolean) =>
			normalizedSearch ? arr.filter(matcher) : arr;

		const normalizedUserRole = normalizeRole(userData?.role as string | undefined);

		const quickTips = filterArray(content.quickTips || [], (tip) =>
			containsTerm(tip),
		);

		const sections = filterArray(content.sections || [], (section) => {
			// Role-based guard for admin-only tutorials
			if (section.requiresRole?.length) {
				const requiredRoles = section.requiresRole
					.map((role) => normalizeRole(role))
					.filter(Boolean);
				if (
					!getUserIsSuccess ||
					!normalizedUserRole ||
					!requiredRoles.includes(normalizedUserRole)
				) {
					return false;
				}
			}

			const haystacks = [
				section.title,
				section.description,
				...(section.steps || []),
				...(section.hints || []),
				...(section.subsections?.flatMap((sub) => [
					sub.title,
					sub.description || "",
					...(sub.steps || []),
					...(sub.hints || []),
				]) || []),
			];
			return haystacks.some((value) => containsTerm(value));
		});

		const dialogSections = filterArray(content.dialogSections || [], (section) => {
			const fieldText =
				section.fields?.flatMap((field) => [
					field.name,
					field.detail || "",
					...(field.tips || []),
				]) || [];
			const haystacks = [
				section.title,
				section.description || "",
				...fieldText,
			];
			return haystacks.some((value) => containsTerm(value));
		});

		const adminRoles = filterArray(content.adminRoles || [], (role) => {
			const haystacks = [
				role.title,
				role.description,
				...(role.bullets || []),
			];
			return haystacks.some((value) => containsTerm(value));
		});

		const statuses = filterArray(content.statuses || [], (status) => {
			const haystacks = [
				status.title,
				status.description,
				status.status,
				...(status.actions || []),
			];
			return haystacks.some((value) => containsTerm(value));
		});

		const faqs = filterArray(content.faqs || [], (faq) => {
			const haystacks = [
				faq.question,
				faq.answer,
				...(faq.bullets || []),
			];
			return haystacks.some((value) => containsTerm(value));
		});

		const samples = filterArray(content.samples || [], (sample) => {
			const haystacks = [
				sample.username,
				sample.status,
				sample.note || "",
				String(sample.expireInDays ?? ""),
				String(sample.dataLimitGb ?? ""),
			];
			return haystacks.some((value) => containsTerm(value));
		});

		return { quickTips, sections, dialogSections, statuses, faqs, samples, adminRoles };
	}, [content, getUserIsSuccess, normalizedSearch, userData]);

	const generalSections = useMemo(
		() => filtered.sections.filter((section) => !section.requiresRole?.length),
		[filtered.sections],
	);
	const adminSections = useMemo(
		() => filtered.sections.filter((section) => section.requiresRole?.length),
		[filtered.sections],
	);
	const adminRoleCards = useMemo(
		() => filtered.adminRoles || [],
		[filtered.adminRoles],
	);
	const currentSections =
		activeTab === "admin" ? adminSections : generalSections;

	const menuItems = useMemo(() => {
		const items: {
			id: string;
			label: string;
			children?: { id: string; label: string }[];
		}[] = [];

		if (activeTab === "general") {
			if (filtered.quickTips.length) {
				items.push({
					id: "quick-tips",
					label: t("tutorials.quickTips"),
				});
			}

			currentSections.forEach((section) => {
				const children =
					section.subsections?.map((sub) => ({
						id: `section-${section.id}-${sub.id}`,
						label: sub.title,
					})) || [];
				items.push({
					id: `section-${section.id}`,
					label: section.title,
					children: children.length ? children : undefined,
				});
			});

			if (filtered.dialogSections.length) {
				const dialogChildren = [
					{ id: "dialog-illustration", label: t("tutorials.dialogFullPreview") },
					...filtered.dialogSections.map((section) => ({
						id: `dialog-${section.id}`,
						label: section.title,
					})),
				];
				items.push({
					id: "dialog-guide",
					label: t("tutorials.dialogGuide"),
					children: dialogChildren,
				});
			}

			if (filtered.samples.length) {
				items.push({
					id: "samples",
					label: t("tutorials.sampleTable"),
				});
			}

			if (filtered.statuses.length) {
				items.push({
					id: "statuses",
					label: t("tutorials.statusGuide"),
					children: filtered.statuses.map((status) => ({
						id: `status-${status.status}`,
						label: status.title,
					})),
				});
			}

			if (filtered.faqs.length) {
				items.push({
					id: "faq",
					label: t("tutorials.faq"),
					children: filtered.faqs.map((faq) => ({
						id: `faq-${faq.id}`,
						label: faq.question,
					})),
				});
			}
		} else {
			currentSections.forEach((section) => {
				const children =
					section.subsections?.map((sub) => ({
						id: `section-${section.id}-${sub.id}`,
						label: sub.title,
					})) || [];
				items.push({
					id: `section-${section.id}`,
					label: section.title,
					children: children.length ? children : undefined,
				});
			});

			if (adminRoleCards.length) {
				items.push({
					id: "admin-roles",
					label: t("tutorials.adminRoles"),
					children: adminRoleCards.map((role) => ({
						id: `admin-role-${role.id}`,
						label: role.title,
					})),
				});
			}
		}

		return items;
	}, [
		activeTab,
		adminRoleCards,
		currentSections,
		filtered.dialogSections,
		filtered.faqs,
		filtered.quickTips,
		filtered.samples,
		filtered.statuses,
		t,
	]);

	const formatExpiryLabel = (days?: number | null) => {
		if (days === null || typeof days === "undefined") {
			return t("tutorials.table.noExpiry");
		}
		if (days === 0) {
			return t("tutorials.table.today");
		}
		if (days > 0) {
			return t("tutorials.table.daysLeft", { count: days });
		}
		return t("tutorials.table.expired", { count: Math.abs(days) });
	};

	const expiryToTimestamp = (days?: number | null) => {
		if (days === null || typeof days === "undefined") return null;
		return dayjs().add(days, "day").endOf("day").unix();
	};

	const formatTraffic = (sample: SampleUser) => {
		const { dataLimitGb, usedGb } = sample;
		if (dataLimitGb === null || typeof dataLimitGb === "undefined") {
			return t("tutorials.table.unlimited");
		}
		const formatNumber = (num: number) =>
			Number.isInteger(num) ? num.toString() : num.toFixed(1);
		if (typeof usedGb === "number") {
			return `${formatNumber(usedGb)} / ${formatNumber(dataLimitGb)} GB`;
		}
		return `${formatNumber(dataLimitGb)} GB`;
	};

	const renderSkeleton = () => (
		<VStack spacing={4} align="stretch">
			<Skeleton h="30px" w="240px" />
			<Skeleton h="16px" w="60%" />
			<Skeleton h="120px" borderRadius="lg" />
			<Skeleton h="220px" borderRadius="lg" />
			<Skeleton h="200px" borderRadius="lg" />
		</VStack>
	);

	const hasNoResults =
		!loading &&
		normalizedSearch &&
		filtered.quickTips.length === 0 &&
		filtered.sections.length === 0 &&
		filtered.dialogSections.length === 0 &&
		filtered.statuses.length === 0 &&
		filtered.faqs.length === 0 &&
		filtered.samples.length === 0;

	const firstMenuId = menuItems[0]?.id;
	useEffect(() => {
		if (!activeId && firstMenuId) {
			setActiveId(firstMenuId);
		}
	}, [activeId, firstMenuId]);

	useEffect(() => {
		if (activeTab === "admin" && menuItems.length === 0) {
			setActiveTab("general");
		}
	}, [activeTab, menuItems.length]);

	useEffect(() => {
		// reset expanded and active on tab change
		setExpandedGroups(new Set());
		if (menuItems.length) {
			setActiveId(menuItems[0].id);
		} else {
			setActiveId(null);
		}
	}, [activeTab, menuItems.length]);
	useEffect(() => {
		if (!activeId) return;
		const parent = menuItems.find(
			(item) =>
				item.id === activeId ||
				item.children?.some((child) => child.id === activeId),
		);
		if (parent?.children?.length) {
			setExpandedFor(parent.id);
		}
	}, [activeId, menuItems]);

	const triggerHighlight = (id: string) => {
		setHighlightId(id);
		if (highlightTimer.current) {
			clearTimeout(highlightTimer.current);
		}
		highlightTimer.current = window.setTimeout(() => {
			setHighlightId((current) => (current === id ? null : current));
		}, 3500);
	};

	const scrollToId = (id: string) => {
		if (typeof document === "undefined") return;
		const el = document.getElementById(id);
		if (!el) return;
		const prefersReduce =
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		el.scrollIntoView({
			behavior: prefersReduce ? "auto" : "smooth",
			block: "start",
			inline: "nearest",
		});
		setActiveId(id);
		triggerHighlight(id);
	};

	const setExpandedFor = (id?: string) => {
		setExpandedGroups((prev) => {
			if (!id) {
				if (prev.size === 0) return prev;
				return new Set<string>();
			}
			if (prev.has(id) && prev.size === 1) {
				return prev;
			}
			return new Set<string>([id]);
		});
	};

	useEffect(() => {
		if (typeof document === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
				if (visible[0]?.target?.id) {
					setActiveId(visible[0].target.id);
				}
			},
			{
				rootMargin: "-12% 0px -65% 0px",
				threshold: [0.25, 0.5, 0.75],
			},
		);

		const ids = menuItems.flatMap((item) => [
			item.id,
			...(item.children?.map((child) => child.id) || []),
		]);
		ids.forEach((id) => {
			const node = document.getElementById(id);
			if (node) observer.observe(node);
		});

		return () => observer.disconnect();
	}, [menuItems]);

	const roleIcons: Record<string, typeof SparkleIcon | undefined> = {
		crown: SparkleIcon,
		shield: ShieldCheck,
		tag: TagShape,
		user: UserShape,
	};

	const highlightStyles = (id: string) => {
		const isActive = highlightId === id;
		return {
			borderColor: isActive ? "primary.300" : "light-border",
			_dark: { borderColor: isActive ? "primary.400" : "whiteAlpha.200" },
			animation: isActive ? `${pulseGlow} 1.2s ease-in-out 0s 2` : undefined,
		};
	};

	useEffect(
		() => () => {
			if (highlightTimer.current) {
				clearTimeout(highlightTimer.current);
			}
		},
		[],
	);

	// Cache scroll position so a refresh returns the reader to the same spot.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const savedValue = window.sessionStorage.getItem(scrollKey);
		if (savedValue) {
			const parsed = Number(savedValue);
			if (!Number.isNaN(parsed)) {
				savedScrollRef.current = parsed;
			}
		}

		const onUnload = () => {
			window.sessionStorage.setItem(scrollKey, String(window.scrollY));
		};

		window.addEventListener("beforeunload", onUnload);
		return () => {
			onUnload();
			window.removeEventListener("beforeunload", onUnload);
		};
	}, [scrollKey]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (hasRestoredScroll.current) return;
		if (loading) return;
		if (savedScrollRef.current !== null) {
			window.scrollTo({ top: savedScrollRef.current, behavior: "auto" });
		}
		hasRestoredScroll.current = true;
	}, [loading]);

	return (
		<VStack spacing={6} align="stretch" dir={isRTL ? "rtl" : "ltr"}>
			<VStack align="flex-start" spacing={1}>
				<HStack spacing={3} align="center">
					<BookIcon />
					<Text as="h1" fontWeight="semibold" fontSize="2xl">
						{t("tutorials.title")}
					</Text>
				</HStack>
				<Text fontSize="sm" color={textMuted}>
					{t("tutorials.subtitle")}
				</Text>
				{content?.intro ? (
					<Text fontSize="sm" color={textMuted}>
						{content.intro}
					</Text>
				) : null}
				{content?.meta?.updated ? (
					<Badge colorScheme="primary">
						{t("tutorials.lastUpdated", { date: content.meta.updated })}
					</Badge>
				) : null}
			</VStack>

			<InputGroup size="md">
				<InputLeftElement pointerEvents="none">
					<SearchIcon />
				</InputLeftElement>
				<Input
					placeholder={t("tutorials.searchPlaceholder")}
					value={searchTerm}
					onChange={(event) => setSearchTerm(event.target.value)}
					bg="surface.light"
					_dark={{ bg: "surface.dark" }}
					borderColor="light-border"
				/>
				{searchTerm ? (
					<InputRightElement width="3rem">
						<IconButton
							aria-label={t("tutorials.clearSearch")}
							size="sm"
							variant="ghost"
							onClick={() => setSearchTerm("")}
							icon={<ClearIcon />}
						/>
					</InputRightElement>
				) : null}
			</InputGroup>

			{error ? (
				<Box
					borderRadius="lg"
					p={3}
					borderWidth="1px"
					borderColor="red.200"
					bg={errorBg}
				>
					<HStack justify="space-between" align="center">
						<Text color="red.600" _dark={{ color: "red.200" }}>
							{error}
						</Text>
						<Button
							size="sm"
							leftIcon={<RetryIcon />}
							onClick={() => void fetchContent()}
						>
							{t("tutorials.retry")}
						</Button>
					</HStack>
				</Box>
			) : null}

			{hasNoResults ? (
				<Box
					borderRadius="lg"
					p={4}
					borderWidth="1px"
					borderColor="light-border"
					bg={innerCardBg}
					_dark={{ borderColor: "whiteAlpha.200" }}
				>
					<Text fontWeight="semibold">
						{t("tutorials.noResults", { term: searchTerm })}
					</Text>
				</Box>
			) : null}

			{loading ? (
				renderSkeleton()
			) : (
				<Flex
					gap={4}
					alignItems="flex-start"
					direction={isRTL ? "row-reverse" : "row"}
					w="full"
				>
					<Box
						w={{ base: "full", md: "280px" }}
						flexShrink={0}
						position="sticky"
						top="80px"
						alignSelf="flex-start"
					>
						<VStack align="stretch" spacing={3}>
							{adminSections.length > 0 && (
								<HStack spacing={2}>
									<Button
										size="sm"
										variant={activeTab === "general" ? "solid" : "outline"}
										colorScheme="primary"
										onClick={() => setActiveTab("general")}
										flex="1"
									>
										{t("tutorials.menuTitle")}
									</Button>
									<Button
										size="sm"
										variant={activeTab === "admin" ? "solid" : "outline"}
										colorScheme="primary"
										onClick={() => setActiveTab("admin")}
										flex="1"
									>
										{t("tutorials.adminTab")}
									</Button>
								</HStack>
							)}
							<Box
								bg={menuCardBg}
								borderWidth="1px"
								borderColor={menuBorder}
								borderRadius="xl"
								boxShadow="md"
								p={3}
							>
								<VStack align="stretch" spacing={3}>
									<Heading size="sm">
										{activeTab === "admin"
											? t("tutorials.adminTab")
											: t("tutorials.menuTitle")}
									</Heading>
									<InputGroup size="sm">
										<InputLeftElement pointerEvents="none">
											<SearchIcon w={4} h={4} />
										</InputLeftElement>
										<Input
											placeholder={t("tutorials.menuSearchPlaceholder")}
											value={searchTerm}
											onChange={(event) => setSearchTerm(event.target.value)}
											bg="surface.light"
											_dark={{ bg: "surface.dark" }}
											borderColor="light-border"
										/>
										{searchTerm ? (
											<InputRightElement width="2.5rem">
												<IconButton
													aria-label={t("tutorials.clearSearch")}
													size="xs"
													variant="ghost"
													onClick={() => setSearchTerm("")}
													icon={<ClearIcon w={4} h={4} />}
												/>
											</InputRightElement>
										) : null}
									</InputGroup>
									<VStack
										align="stretch"
										spacing={1}
										maxH="70vh"
										overflowY="auto"
										borderRadius="lg"
									>
										{menuItems.map((item) => {
											const isActive =
												activeId === item.id ||
												item.children?.some((child) => child.id === activeId);
											const hasChildren = (item.children || []).length > 0;
											const isExpanded = expandedGroups.has(item.id);
											return (
												<Box
													key={item.id}
													borderRadius="md"
													overflow="hidden"
													borderWidth="1px"
													borderColor={
														isActive ? "primary.200" : "transparent"
													}
												>
													<Button
														size="sm"
														variant="ghost"
														justifyContent="space-between"
														w="full"
														bg={isActive ? menuActiveBg : "transparent"}
														_hover={{ bg: menuHoverBg }}
														_active={{ bg: menuActiveBg }}
														onClick={() => {
															if (hasChildren) {
																setExpandedFor(isExpanded ? undefined : item.id);
															}
															scrollToId(item.id);
														}}
														rightIcon={
															hasChildren ? (
																<ChevronDownIcon
																	style={{
																		transform: isExpanded
																			? "rotate(180deg)"
																			: "rotate(0deg)",
																		transition: "transform 120ms ease",
																	}}
																/>
															) : undefined
														}
													>
														<Text textAlign="start">{item.label}</Text>
													</Button>
													{hasChildren && isExpanded ? (
														<VStack
															align="stretch"
															ps={4}
															pe={2}
															pb={2}
															spacing={1}
															borderLeftWidth="2px"
															borderLeftColor="primary.200"
														>
															{item.children?.map((child) => {
																const childActive = activeId === child.id;
																return (
																	<Button
																		key={child.id}
																		size="xs"
																		variant="ghost"
																		justifyContent="flex-start"
																		bg={
																			childActive
																				? menuActiveBg
																				: "transparent"
																		}
																		_hover={{ bg: menuHoverBg }}
																		_active={{ bg: menuActiveBg }}
																		onClick={() => scrollToId(child.id)}
																	>
																		{child.label}
																	</Button>
																);
															})}
														</VStack>
													) : null}
												</Box>
											);
										})}
									</VStack>
								</VStack>
							</Box>
						</VStack>
					</Box>
			<Box flex="1" minW={0}>
				{activeTab === "general" && content?.panelIntro ? (
					<Box {...cardStyles} id="panel-intro">
						<HStack spacing={2} mb={2}>
							<SparkleIcon />
							<Text fontWeight="semibold">{content.panelIntro.title}</Text>
						</HStack>
						{content.panelIntro.description ? (
							<Text fontSize="sm" color={textMuted} mb={2}>
								{content.panelIntro.description}
							</Text>
						) : null}
						{content.panelIntro.bullets?.length ? (
							<List spacing={2} stylePosition="inside" mb={content.panelIntro.links?.length ? 3 : 0}>
								{content.panelIntro.bullets.map((tip, index) => (
									<ListItem key={`panel-tip-${index}`}>
										<ListIcon as={CheckIcon} color="primary.500" />
										<Text as="span">{tip}</Text>
									</ListItem>
								))}
							</List>
						) : null}
						{content.panelIntro.links?.length ? (
							<HStack spacing={2} flexWrap="wrap">
								{content.panelIntro.links.map((link, idx) => (
									<Button
										key={`panel-link-${idx}`}
										size="sm"
										variant={link.action === "url" ? "outline" : "solid"}
										colorScheme="primary"
										onClick={() => {
											if (link.action === "navigate") {
												navigate(link.target);
											} else {
												window.open(link.target, "_blank", "noopener,noreferrer");
											}
										}}
									>
										{link.label}
									</Button>
								))}
							</HStack>
						) : null}
					</Box>
				) : null}

				{activeTab === "general" && filtered.quickTips.length ? (
					<Box {...cardStyles} {...highlightStyles("quick-tips")} id="quick-tips">
						<HStack spacing={2} mb={2}>
							<SparkleIcon />
							<Text fontWeight="semibold">{t("tutorials.quickTips")}</Text>
						</HStack>
						<List spacing={2} stylePosition="inside">
							{filtered.quickTips.map((tip, index) => (
								<ListItem key={`tip-${index}`}>
									<ListIcon as={CheckIcon} color="primary.500" />
									<Text as="span">{tip}</Text>
								</ListItem>
							))}
						</List>
					</Box>
				) : null}

				{currentSections.length ? (
					<Box {...cardStyles} id="sections-block" mt={4}>
						<HStack spacing={2} mb={4}>
							<InfoIcon />
							<Text fontWeight="semibold">{t("tutorials.walkthroughs")}</Text>
						</HStack>
						<VStack spacing={4} align="stretch">
							{currentSections.map((section, index) => (
								<Box
									key={section.id}
									id={`section-${section.id}`}
									borderWidth="1px"
									borderRadius="lg"
									bg={innerCardBg}
									p={3}
									{...highlightStyles(`section-${section.id}`)}
									scrollMarginTop="160px"
								>
									<VStack align="stretch" spacing={2}>
										<Text fontWeight="semibold">{section.title}</Text>
										<Text fontSize="sm" color={textMuted}>
											{section.description}
										</Text>
										{!section.subsections?.length && section.id.includes("create-user") && (
											<HStack spacing={2} flexWrap="wrap">
												<Button
													size="sm"
													variant="outline"
													onClick={() => navigate("/users")}
												>
													{t("users")}
												</Button>
												<Button
													size="sm"
													colorScheme="primary"
													onClick={() => {
														sessionStorage.setItem("openCreateUser", "true");
														navigate("/users");
													}}
												>
													{t("createUser")}
												</Button>
											</HStack>
										)}
										{!section.subsections?.length && section.id.includes("myaccount") && (
											<HStack spacing={2} flexWrap="wrap">
												<Button
													size="sm"
													variant="outline"
													onClick={() => navigate("/myaccount")}
												>
													{t("tutorials.openMyAccount")}
												</Button>
											</HStack>
										)}
										{!section.subsections?.length &&
											section.id.includes("admins-page") && (
												<HStack spacing={2} flexWrap="wrap">
													<Button
														size="sm"
														variant="outline"
														onClick={() => navigate("/admins")}
													>
														{t("tutorials.openAdmins")}
													</Button>
													<Button
														size="sm"
														colorScheme="primary"
														onClick={() => {
															sessionStorage.setItem("openCreateAdmin", "true");
															navigate("/admins");
														}}
													>
														{t("tutorials.openCreateAdmin")}
													</Button>
												</HStack>
											)}
										{section.id.includes("admins-page") && (
											<HStack spacing={2} flexWrap="wrap">
												<Button
													size="sm"
													variant="outline"
													onClick={() => navigate("/admins")}
												>
													{t("tutorials.openAdmins")}
												</Button>
												<Button
													size="sm"
													colorScheme="primary"
													onClick={() => {
														sessionStorage.setItem("openCreateAdmin", "true");
														navigate("/admins");
													}}
												>
													{t("tutorials.openCreateAdmin")}
												</Button>
											</HStack>
										)}
										{section.steps?.length ? (
											<OrderedList spacing={1} ps={4}>
												{section.steps.map((step, idx) => (
													<ListItem key={`${section.id}-step-${idx}`}>
														{step}
													</ListItem>
												))}
											</OrderedList>
										) : null}
										{section.hints?.length ? (
											<Box borderRadius="md" p={2} bg={hintBg}>
												<HStack spacing={2} mb={1}>
													<HintIcon w={4} h={4} />
													<Text fontSize="sm" fontWeight="medium">
														{t("tutorials.hints")}
													</Text>
												</HStack>
												<List spacing={1.5} stylePosition="inside">
													{section.hints.map((hint, idx) => (
														<ListItem key={`${section.id}-hint-${idx}`}>
															{hint}
														</ListItem>
													))}
												</List>
											</Box>
										) : null}
										{section.subsections?.length ? (
											<VStack align="stretch" spacing={3}>
												{section.subsections.map((sub) => (
													<Box
														key={sub.id}
														id={`section-${section.id}-${sub.id}`}
														borderWidth="1px"
														borderColor={
															highlightId === `section-${section.id}-${sub.id}`
																? "primary.300"
																: sub.color
																	? `${sub.color}.300`
																	: "light-border"
														}
														borderRadius="md"
														p={3}
														_dark={{
															borderColor:
																highlightId === `section-${section.id}-${sub.id}`
																	? "primary.400"
																	: sub.color
																		? `${sub.color}.400`
																		: "whiteAlpha.200",
														}}
														bg={hintBg}
														scrollMarginTop="160px"
														animation={
															highlightId === `section-${section.id}-${sub.id}`
																? `${pulseGlow} 1.2s ease-in-out 0s 2`
																: undefined
														}
													>
														<VStack align="stretch" spacing={2}>
															<HStack spacing={2}>
																{roleIcons[sub.icon || ""] ? (
																	<Box
																		bg={`${sub.color || "gray"}.100`}
																		_dark={{ bg: `${sub.color || "gray"}.700` }}
																		borderRadius="full"
																		p={2}
																		display="inline-flex"
																		alignItems="center"
																		justifyContent="center"
																	>
																		{(() => {
																			const IconComp = roleIcons[sub.icon || ""];
																			if (!IconComp) return null;
																			return (
																				<IconComp
																					color={
																						sub.color
																							? `${sub.color}.600`
																							: "primary.500"
																					}
																				/>
																			);
																		})()}
																	</Box>
																) : null}
																<VStack align="stretch" spacing={0}>
																	<Text fontWeight="semibold">{sub.title}</Text>
																	{sub.description ? (
																		<Text fontSize="sm" color={textMuted}>
																			{sub.description}
																		</Text>
																	) : null}
																</VStack>
															</HStack>
															{sub.steps?.length ? (
															<OrderedList spacing={1} ps={4}>
																{sub.steps.map((step, idx) => (
																	<ListItem key={`${section.id}-${sub.id}-step-${idx}`}>
																		{step}
																	</ListItem>
																))}
															</OrderedList>
															) : null}
															{sub.hints?.length ? (
																<Box borderRadius="md" p={2} bg={innerCardBg}>
																	<HStack spacing={2} mb={1}>
																		<HintIcon w={4} h={4} />
																		<Text fontSize="sm" fontWeight="medium">
																			{t("tutorials.hints")}
																		</Text>
																	</HStack>
																	<List spacing={1.5} stylePosition="inside">
																		{sub.hints.map((hint, idx) => (
																			<ListItem key={`${section.id}-${sub.id}-hint-${idx}`}>
																				{hint}
																			</ListItem>
																		))}
																	</List>
																</Box>
															) : null}
														</VStack>
													</Box>
												))}
											</VStack>
										) : null}
									</VStack>
									{index !== filtered.sections.length - 1 ? (
										<Divider my={3} />
									) : null}
								</Box>
							))}
						</VStack>
					</Box>
				) : null}

				{activeTab === "general" && filtered.dialogSections.length ? (
					<Box
						{...cardStyles}
						{...highlightStyles("dialog-guide")}
						id="dialog-guide"
						mt={4}
					>
						<HStack spacing={2} mb={4}>
							<BookIcon />
							<Text fontWeight="semibold">{t("tutorials.dialogGuide")}</Text>
						</HStack>
						<VStack spacing={3} align="stretch">
							{filtered.dialogSections.map((section, index) => (
								<Box
									key={section.id}
									id={`dialog-${section.id}`}
									borderWidth="1px"
									borderRadius="lg"
									bg={innerCardBg}
									p={3}
									{...highlightStyles(`dialog-${section.id}`)}
									scrollMarginTop="160px"
								>
									<VStack align="stretch" spacing={2}>
										<Text fontWeight="semibold">{section.title}</Text>
										{section.description ? (
											<Text fontSize="sm" color={textMuted}>
												{section.description}
											</Text>
										) : null}
										{section.fields?.length ? (
											<VStack align="stretch" spacing={2}>
												{section.fields.map((field, idx) => (
													<Box
														key={`${section.id}-field-${idx}`}
														borderWidth="1px"
														borderRadius="md"
														borderColor="light-border"
														_dark={{ borderColor: "whiteAlpha.200" }}
														p={3}
														bg={hintBg}
													>
														<Text fontWeight="semibold">{field.name}</Text>
														{field.detail ? (
															<Text fontSize="sm" color={textMuted} mt={1}>
																{field.detail}
															</Text>
														) : null}
														{field.tips?.length ? (
															<List spacing={1} mt={2} stylePosition="inside">
																{field.tips.map((tip, tipIdx) => (
																	<ListItem
																		key={`${section.id}-field-${idx}-tip-${tipIdx}`}
																	>
																		<ListIcon as={CheckIcon} color="primary.500" />
																		<Text as="span">{tip}</Text>
																	</ListItem>
																))}
															</List>
														) : null}
													</Box>
												))}
											</VStack>
										) : null}
									</VStack>
									{index !== filtered.dialogSections.length - 1 ? (
										<Divider my={3} />
									) : null}
								</Box>
							))}
						</VStack>
					</Box>
				) : null}

				{activeTab === "general" && filtered.samples.length ? (
					<Box {...cardStyles} {...highlightStyles("samples")} id="samples" mt={4}>
						<HStack spacing={2} mb={2}>
							<InfoIcon />
							<Text fontWeight="semibold">{t("tutorials.sampleTable")}</Text>
						</HStack>
						<Text fontSize="sm" color={textMuted} mb={3}>
							{t("tutorials.sampleTableNote")}
						</Text>
						<TableContainer
							overflowX="auto"
							borderWidth="1px"
							borderColor="light-border"
							borderRadius="lg"
							_dark={{ borderColor: "whiteAlpha.200" }}
							boxShadow="sm"
						>
							<Table size="sm" variant="striped" colorScheme="blackAlpha">
								<Thead>
									<Tr>
										<Th fontWeight="bold">{t("tutorials.table.username")}</Th>
										<Th fontWeight="bold">{t("tutorials.table.status")}</Th>
										<Th fontWeight="bold">{t("tutorials.table.expire")}</Th>
										<Th fontWeight="bold">{t("tutorials.table.traffic")}</Th>
										<Th fontWeight="bold">{t("tutorials.table.note")}</Th>
									</Tr>
								</Thead>
								<Tbody>
									{filtered.samples.map((sample) => {
										const expiryLabel = formatExpiryLabel(sample.expireInDays);
										const expiryTimestamp = expiryToTimestamp(sample.expireInDays);
										return (
											<Tr
												key={sample.username}
												_hover={{ bg: rowHoverBg }}
											>
												<Td fontWeight="medium">{sample.username}</Td>
												<Td>
													<StatusBadge
														status={sample.status}
														expiryDate={expiryTimestamp ?? undefined}
														compact
													/>
												</Td>
												<Td>
													<Text fontSize="sm">{expiryLabel}</Text>
												</Td>
												<Td>
													<Text fontSize="sm" dir="ltr">
														{formatTraffic(sample)}
													</Text>
												</Td>
												<Td>
													<VStack align="flex-start" spacing={1}>
														<Text fontSize="sm">
															{sample.note || "-"}
														</Text>
														{typeof sample.ipLimit === "number" ? (
															<Tag colorScheme="gray" size="sm">
																{t("tutorials.table.ipLimit", {
																	count: sample.ipLimit,
																})}
															</Tag>
														) : null}
													</VStack>
												</Td>
											</Tr>
										);
									})}
								</Tbody>
							</Table>
						</TableContainer>
					</Box>
				) : null}

				{activeTab === "general" && filtered.statuses.length ? (
					<Box {...cardStyles} {...highlightStyles("statuses")} id="statuses" mt={4}>
						<HStack spacing={2} mb={4}>
							<InfoIcon />
							<Text fontWeight="semibold">{t("tutorials.statusGuide")}</Text>
						</HStack>
						<VStack align="stretch" spacing={3}>
							{filtered.statuses.map((status, idx) => (
								<Box
									key={status.status}
									borderWidth="1px"
									borderRadius="lg"
									bg={innerCardBg}
									p={3}
									{...highlightStyles(`status-${status.status}`)}
								>
									<VStack align="stretch" spacing={2}>
										<StatusBadge status={status.status} showDetail />
										<Text fontWeight="semibold">{status.title}</Text>
										<Text fontSize="sm" color={textMuted}>
											{status.description}
										</Text>
										{status.actions?.length ? (
											<Stack spacing={1.5} mt={1}>
												<Text fontSize="sm" fontWeight="medium">
													{t("tutorials.actions")}
												</Text>
												<List spacing={1} stylePosition="inside">
													{status.actions.map((action, aIdx) => (
														<ListItem key={`${status.status}-action-${aIdx}`}>
															<ListIcon as={CheckIcon} color="primary.500" />
															<Text as="span">{action}</Text>
														</ListItem>
													))}
												</List>
											</Stack>
										) : null}
									</VStack>
									{idx !== filtered.statuses.length - 1 ? (
										<Divider my={3} />
									) : null}
								</Box>
							))}
						</VStack>
					</Box>
				) : null}

				{activeTab === "admin" && adminRoleCards.length ? (
					<Box {...cardStyles} {...highlightStyles("admin-roles")} id="admin-roles" mt={4}>
						<HStack spacing={2} mb={4}>
							<InfoIcon />
							<Text fontWeight="semibold">{t("tutorials.adminRoles")}</Text>
						</HStack>
						<VStack align="stretch" spacing={3}>
							{adminRoleCards.map((role, idx) => (
								<Box
									key={role.id}
									id={`admin-role-${role.id}`}
									borderWidth="1px"
									borderRadius="lg"
									bg={innerCardBg}
									p={3}
									{...highlightStyles(`admin-role-${role.id}`)}
								>
									<VStack align="stretch" spacing={2}>
										<Text fontWeight="semibold">{role.title}</Text>
										<Text fontSize="sm" color={textMuted}>
											{role.description}
										</Text>
										{role.bullets?.length ? (
											<List spacing={1.5} stylePosition="inside">
												{role.bullets.map((bullet, bIdx) => (
													<ListItem key={`${role.id}-bullet-${bIdx}`}>
														<ListIcon as={CheckIcon} color="primary.500" />
														<Text as="span">{bullet}</Text>
													</ListItem>
												))}
											</List>
										) : null}
									</VStack>
									{idx !== adminRoleCards.length - 1 ? <Divider my={3} /> : null}
								</Box>
							))}
						</VStack>
					</Box>
				) : null}

				{activeTab === "general" && filtered.faqs.length ? (
					<Box {...cardStyles} {...highlightStyles("faq")} id="faq" mt={4}>
						<HStack spacing={2} mb={2}>
							<QuestionIcon />
							<Text fontWeight="semibold">{t("tutorials.faq")}</Text>
						</HStack>
						<VStack spacing={3} align="stretch">
							{filtered.faqs.map((faq, idx) => (
								<Box
									key={faq.id}
									id={`faq-${faq.id}`}
									borderWidth="1px"
									borderRadius="lg"
									p={3}
									{...highlightStyles(`faq-${faq.id}`)}
								>
									<VStack align="stretch" spacing={2}>
										<Text fontWeight="semibold">{faq.question}</Text>
										{faq.id === "subscription-basics" ? (
											<Text fontSize="sm">
												اشتراک همان یوزر است با لینک اتصال. از صفحه{" "}
												<Link
													color="primary.500"
													fontWeight="semibold"
													onClick={() => navigate("/users")}
													textDecoration="underline"
												>
													کاربران
												</Link>{" "}
												دکمه{" "}
												<Link
													color="primary.500"
													fontWeight="semibold"
													onClick={() => {
														sessionStorage.setItem("openCreateUser", "true");
														navigate("/users");
													}}
													textDecoration="underline"
												>
													ساخت یوزر
												</Link>{" "}
												را بزن تا یک اشتراک بسازی.
											</Text>
										) : (
											<Text fontSize="sm">{faq.answer}</Text>
										)}
										{faq.bullets?.length ? (
											<List spacing={1.5} stylePosition="inside">
												{faq.bullets.map((bullet, bIdx) => (
													<ListItem key={`${faq.id}-bullet-${bIdx}`}>
														<ListIcon as={CheckIcon} color="primary.500" />
														{faq.id === "subscription-basics" &&
														bullet.includes("ساخت یوزر") ? (
															<>
																<Text as="span">برای ساخت سریع، روی </Text>
																<Link
																	color="primary.500"
																	fontWeight="semibold"
																	onClick={() => {
																		sessionStorage.setItem("openCreateUser", "true");
																		navigate("/users");
																	}}
																	textDecoration="underline"
																	cursor="pointer"
																>
																	ساخت یوزر
																</Link>
																<Text as="span"> کلیک کن تا دیالوگ ساخت باز شود.</Text>
															</>
														) : (
															<Text as="span">{bullet}</Text>
														)}
													</ListItem>
												))}
											</List>
										) : null}
									</VStack>
									{idx !== filtered.faqs.length - 1 ? (
										<Divider my={3} />
									) : null}
								</Box>
							))}
						</VStack>
					</Box>
				) : null}
			</Box>
		</Flex>
	)}
</VStack>
);
};

export default TutorialsPage;
