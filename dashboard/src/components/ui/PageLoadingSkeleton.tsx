import logoUrl from "assets/logo.svg";
import {
	Box,
	Flex,
	HStack,
	SimpleGrid,
	VStack,
} from "@chakra-ui/react";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const PageLoadingSkeleton: FC = () => (
	<Box
		w="full"
		h={{
			base: "calc(100dvh - 162px - env(safe-area-inset-bottom, 0px))",
			md: "calc(100vh - 24px)",
		}}
		maxH={{
			base: "calc(100dvh - 162px - env(safe-area-inset-bottom, 0px))",
			md: "calc(100vh - 24px)",
		}}
		borderRadius="20px"
		borderWidth="1px"
		borderColor="panel.border"
		bg="panel.surface"
		boxShadow="0 1px 2px rgba(0, 0, 0, 0.03)"
		className="rb-glass-item"
		sx={{
			"@keyframes rbGlassPulse": {
				"0%, 100%": {
					opacity: 0.42,
					transform: "scale(1)",
				},
				"50%": {
					opacity: 0.78,
					transform: "scale(1.002)",
				},
			},
			"&.rb-glass-item": {
				animation: "rbGlassPulse 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
			},
		}}
	/>
);

export const PanelLoadingSkeleton: FC = () => {
	const { i18n } = useTranslation();
	const [isMobileScreen, setIsMobileScreen] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.innerWidth < 769;
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mq = window.matchMedia("(max-width: 768.98px)");
		const update = () => setIsMobileScreen(mq.matches);
		update();
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	}, []);

	const isRTL = i18n
		? i18n.dir(i18n.language) === "rtl"
		: typeof document !== "undefined"
			? document.documentElement.dir === "rtl" ||
				document.documentElement.lang === "fa" ||
				(typeof localStorage !== "undefined" &&
					localStorage.getItem("i18nextLng") === "fa")
			: true;

	return (
		<Box
			minH={{ base: "100dvh", md: "100vh" }}
			maxH={{ base: "100dvh", md: "100vh" }}
			h={{ base: "100dvh", md: "100vh" }}
			w="full"
			bg="panel.app"
			dir={isRTL ? "rtl" : "ltr"}
			position="relative"
			overflow="hidden"
			sx={{
				"@keyframes rbGlassPulse": {
					"0%, 100%": {
						opacity: 0.42,
						transform: "scale(1)",
					},
					"50%": {
						opacity: 0.78,
						transform: "scale(1.002)",
					},
				},
				"& .rb-glass-item": {
					animation: "rbGlassPulse 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
				},
			}}
		>
			{!isMobileScreen && (
				<Box
					className="rb-desktop-sidebar"
					display={{ base: "none", md: "flex" }}
					position="fixed"
					top="12px"
					bottom="12px"
					right={isRTL ? "12px" : "auto"}
					left={isRTL ? "auto" : "12px"}
					w="var(--rb-sidebar-width, 240px)"
					h="calc(100vh - 24px)"
					maxH="calc(100vh - 24px)"
					bg="panel.surface"
					borderWidth="1px"
				borderColor="panel.border"
				borderRadius="20px"
				boxShadow="0 1px 2px rgba(0, 0, 0, 0.03)"
				zIndex={200}
				flexDirection="column"
				overflow="hidden"
			>
				<Flex
					direction="column"
					h="full"
					justify="space-between"
					p={3}
				>
					<Flex
						align="center"
						justify="space-between"
						px="10px"
						py={2.5}
						mb={2}
						minH="48px"
						borderBottomWidth="1px"
						borderColor="panel.border"
						flexShrink={0}
					>
						<HStack spacing={2.5} align="center">
							<Box
								as="img"
								src={logoUrl}
								alt="Rebecca"
								w="28px"
								h="28px"
								flexShrink={0}
							/>
							<Box
								w="78px"
								h="18px"
								borderRadius="md"
								bg="panel.elevated"
								className="rb-glass-item"
							/>
						</HStack>
					</Flex>

					<Box flex="1" minH={0} overflow="hidden" px={1}>
						<VStack align="stretch" spacing={2} py={1}>
							<Box mb={1}>
								<Box
									w="50px"
									h="10px"
									borderRadius="sm"
									bg="panel.elevated"
									px={3}
									mb={1.5}
									className="rb-glass-item"
								/>
								<Flex
									h="36px"
									borderRadius="10px"
									bg="panel.elevated"
									px={2.5}
									align="center"
									justify="space-between"
									mb={1}
									borderInlineStart="2.5px solid"
									borderInlineStartColor="panel.borderStrong"
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.border"
											flexShrink={0}
										/>
										<Box
											w="60px"
											h="14px"
											borderRadius="md"
											bg="panel.border"
										/>
									</HStack>
								</Flex>

								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									justify="space-between"
									mb={1}
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="55px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
									<Box
										w="10px"
										h="10px"
										borderRadius="sm"
										bg="panel.elevated"
									/>
								</Flex>

								<Box
									ms="16px"
									ps="10px"
									my={1}
									borderInlineStart="1.5px solid"
									borderColor="panel.border"
								>
									<Flex
										h="28px"
										borderRadius="6px"
										px={2}
										align="center"
										mb={1}
										className="rb-glass-item"
									>
										<HStack spacing={2}>
											<Box
												w="14px"
												h="14px"
												borderRadius="sm"
												bg="panel.elevated"
												flexShrink={0}
											/>
											<Box
												w="65px"
												h="12px"
												borderRadius="md"
												bg="panel.elevated"
											/>
										</HStack>
									</Flex>
									<Flex
										h="28px"
										borderRadius="6px"
										px={2}
										align="center"
										className="rb-glass-item"
									>
										<HStack spacing={2}>
											<Box
												w="14px"
												h="14px"
												borderRadius="sm"
												bg="panel.elevated"
												flexShrink={0}
											/>
											<Box
												w="75px"
												h="12px"
												borderRadius="md"
												bg="panel.elevated"
											/>
										</HStack>
									</Flex>
								</Box>

								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="50px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
								</Flex>
							</Box>

							<Box mb={1}>
								<Box
									w="65px"
									h="10px"
									borderRadius="sm"
									bg="panel.elevated"
									px={3}
									mb={1.5}
									className="rb-glass-item"
								/>
								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									mb={1}
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="55px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
								</Flex>
								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									mb={1}
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="45px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
								</Flex>
								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="60px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
								</Flex>
							</Box>

							<Box mb={1}>
								<Box
									w="70px"
									h="10px"
									borderRadius="sm"
									bg="panel.elevated"
									px={3}
									mb={1.5}
									className="rb-glass-item"
								/>
								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									justify="space-between"
									mb={1}
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="68px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
									<Box
										w="10px"
										h="10px"
										borderRadius="sm"
										bg="panel.elevated"
									/>
								</Flex>
								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									justify="space-between"
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="72px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
									<Box
										w="10px"
										h="10px"
										borderRadius="sm"
										bg="panel.elevated"
									/>
								</Flex>
							</Box>

							<Box>
								<Box
									w="45px"
									h="10px"
									borderRadius="sm"
									bg="panel.elevated"
									px={3}
									mb={1.5}
									className="rb-glass-item"
								/>
								<Flex
									h="34px"
									borderRadius="8px"
									px={2.5}
									align="center"
									className="rb-glass-item"
								>
									<HStack spacing={2.5}>
										<Box
											w="18px"
											h="18px"
											borderRadius="4px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box
											w="85px"
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</HStack>
								</Flex>
							</Box>
						</VStack>
					</Box>
					<Box
						w="full"
						h="52px"
						borderRadius="14px"
						borderWidth="1px"
						borderColor="panel.border"
						bg="panel.elevated"
						mt={2}
						flexShrink={0}
						className="rb-glass-item"
					/>
				</Flex>
			</Box>
		)}

			<Flex
				flex="1"
				direction="column"
				minW="0"
				overflow="hidden"
				mr={{
					base: "0",
					md: isRTL ? "calc(var(--rb-sidebar-width, 240px) + 20px)" : "0",
				}}
				ml={{
					base: "0",
					md: isRTL ? "0" : "calc(var(--rb-sidebar-width, 240px) + 20px)",
				}}
				bg="panel.main"
				position="relative"
			>
				<Box position="relative" zIndex={100} flexShrink={0}>
					<Box
						as="header"
						h="52px"
						minH="52px"
						borderWidth="1px"
						borderColor="panel.border"
						borderRadius="18px"
						bg="panel.surface"
						boxShadow="0 1px 2px rgba(0, 0, 0, 0.03)"
						backdropFilter="blur(16px)"
						mt="3"
						mx={{ base: "3", md: "4" }}
						display="flex"
						alignItems="center"
						px={{ base: 3, md: 5 }}
						justifyContent="space-between"
						gap={3}
						dir={isRTL ? "rtl" : "ltr"}
					>
						<HStack
							spacing={2.5}
							alignItems="center"
							flex="1"
							minW="0"
							h="full"
							overflow="hidden"
						>
							<Box
								w="34px"
								h="34px"
								minW="34px"
								borderRadius={{ base: "full", md: "12px" }}
								borderWidth="1px"
								borderColor="panel.border"
								bg="panel.elevated"
								flexShrink={0}
								className="rb-glass-item"
							/>
							<Box
								w="1px"
								h="16px"
								bg="panel.border"
								mx={0.5}
								flexShrink={0}
								display={{ base: "none", md: "block" }}
							/>
							<Box
								display={{ base: "none", md: "block" }}
								w="85px"
								h="18px"
								borderRadius="md"
								bg="panel.elevated"
								flexShrink={0}
								className="rb-glass-item"
							/>
						</HStack>

						<HStack
							spacing={{ base: 1.5, sm: 2 }}
							alignItems="center"
							flexShrink={0}
							h="full"
						>
							<Box
								display={{ base: "none", md: "block" }}
								w="34px"
								h="34px"
								borderRadius="12px"
								borderWidth="1px"
								borderColor="panel.border"
								bg="panel.elevated"
								className="rb-glass-item"
							/>
							<Box
								display={{ base: "none", sm: "block" }}
								w="72px"
								h="32px"
								borderRadius="12px"
								borderWidth="1px"
								borderColor="panel.border"
								bg="panel.elevated"
								className="rb-glass-item"
							/>
							<Flex
								display={{ base: "none", md: "inline-flex" }}
								align="center"
								justify="center"
								w="auto"
								minW="110px"
								h="34px"
								borderRadius="12px"
								borderWidth="1px"
								borderColor="panel.border"
								bg="panel.surface"
								px={2.5}
								gap={2}
								className="rb-glass-item"
							>
								<Box
									w="20px"
									h="20px"
									borderRadius="full"
									bg="panel.elevated"
									flexShrink={0}
								/>
								<Box
									w="64px"
									h="12px"
									borderRadius="sm"
									bg="panel.elevated"
								/>
							</Flex>
							<Flex
								display={{ base: "inline-flex", md: "none" }}
								align="center"
								justify="center"
								w="34px"
								h="34px"
								borderRadius="full"
								borderWidth="1px"
								borderColor="panel.border"
								bg="panel.surface"
								className="rb-glass-item"
							>
								<Box
									w="20px"
									h="20px"
									borderRadius="full"
									bg="panel.elevated"
									flexShrink={0}
								/>
							</Flex>
						</HStack>
					</Box>
				</Box>

				<Box
					flex="1"
					px={{ base: "3", md: "4" }}
					pt="3"
					pb={{ base: "20", md: "3" }}
					minH="0"
					w="full"
					h="full"
					display="flex"
					flexDirection="column"
				>
					<Box
						w="full"
						h={{
							base: "calc(100dvh - 162px - env(safe-area-inset-bottom, 0px))",
							md: "calc(100vh - 24px)",
						}}
						maxH={{
							base: "calc(100dvh - 162px - env(safe-area-inset-bottom, 0px))",
							md: "calc(100vh - 24px)",
						}}
						borderRadius="20px"
						borderWidth="1px"
						borderColor="panel.border"
						bg="panel.surface"
						boxShadow="0 1px 2px rgba(0, 0, 0, 0.03)"
						className="rb-glass-item"
					/>
				</Box>
			</Flex>

			{isMobileScreen && (
				<Box
					className="rb-mobile-dock"
					display={{ base: "block", md: "none" }}
					position="fixed"
					bottom="calc(env(safe-area-inset-bottom, 0px) + 12px)"
					left="0"
					right="0"
					zIndex={1500}
					px="3"
					pointerEvents="none"
				>
				<Box
					maxW="min(440px, calc(100vw - 20px))"
					mx="auto"
					borderRadius="24px"
					borderWidth="1px"
					borderColor="panel.border"
					bg="panel.surface"
					boxShadow="0 20px 48px rgba(0, 0, 0, 0.4)"
					px="2"
					py="1.5"
				>
					<SimpleGrid
						columns={5}
						spacing={0}
						w="full"
						alignItems="center"
						dir={isRTL ? "rtl" : "ltr"}
					>
						{[
							{ id: "skel-dock-users", w: "28px", active: false },
							{ id: "skel-dock-admins", w: "32px", active: false },
							{ id: "skel-dock-dash", w: "38px", active: true },
							{ id: "skel-dock-account", w: "34px", active: false },
							{ id: "skel-dock-settings", w: "30px", active: false },
						].map((item) => (
							<Box
								key={item.id}
								w="full"
								display="flex"
								flexDirection="column"
								alignItems="center"
								justifyContent="center"
								py="1"
								px="1"
								position="relative"
							>
								<Box
									w="full"
									h="full"
									py="1"
									display="flex"
									flexDirection="column"
									alignItems="center"
									justifyContent="center"
									borderRadius={item.active ? "16px" : undefined}
									bg={item.active ? "panel.elevated" : "transparent"}
									borderWidth={item.active ? "1px" : "0px"}
									borderColor="panel.border"
									className="rb-glass-item"
								>
									<Box
										w="22px"
										h="22px"
										borderRadius="6px"
										bg={item.active ? "panel.border" : "panel.elevated"}
									/>
									<Box
										w={item.w}
										h="8px"
										borderRadius="sm"
										mt="4px"
										bg={item.active ? "panel.border" : "panel.elevated"}
									/>
								</Box>
							</Box>
						))}
					</SimpleGrid>
				</Box>
			</Box>
		)}
	</Box>
);
};