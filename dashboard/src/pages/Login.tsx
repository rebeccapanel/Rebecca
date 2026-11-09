import {
	Alert,
	AlertDescription,
	AlertIcon,
	Box,
	Button,
	chakra,
	FormControl,
	FormErrorMessage,
	FormLabel,
	HStack,
	IconButton,
	Input as CInput,
	InputGroup,
	InputLeftElement,
	InputRightElement,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
	Text,
	Tooltip,
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowRightOnRectangleIcon,
	CheckIcon,
	ClipboardDocumentCheckIcon,
	ClipboardDocumentIcon,
	EyeIcon,
	EyeSlashIcon,
	LockClosedIcon,
	MoonIcon,
	ShieldCheckIcon,
	SunIcon,
	UserIcon,
} from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import logoUrl from "assets/logo.svg";
import { Language } from "components/Language";
import { AnimatePresence, motion } from "framer-motion";
import {
	type FC,
	type ReactElement,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import {
	type FieldErrors,
	useForm,
	type UseFormRegisterReturn,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import {
	confirm2FASetup,
	getSession,
	login as createSession,
	logout,
	start2FASetup,
	type TOTPSetup,
	verify2FA,
} from "service/auth";
import { clearClientSession } from "utils/session";
import { updateThemeColor } from "utils/themeColor";
import { z } from "zod";

const schema = z.object({
	username: z.string().min(1, "login.fieldRequired"),
	password: z.string().min(1, "login.fieldRequired"),
});

export const LogoIcon = chakra("img", {
	baseStyle: {
		h: 8,
		w: 8,
	},
});

const LoginIcon = chakra(ArrowRightOnRectangleIcon, {
	baseStyle: {
		h: 5,
		strokeWidth: "2px",
		w: 5,
	},
});

const Eye = chakra(EyeIcon, { baseStyle: { h: 4, w: 4 } });
const EyeSlash = chakra(EyeSlashIcon, { baseStyle: { h: 4, w: 4 } });
const User = chakra(UserIcon, { baseStyle: { h: 5, strokeWidth: "1.8px", w: 5 } });
const Lock = chakra(LockClosedIcon, {
	baseStyle: { h: 5, strokeWidth: "1.8px", w: 5 },
});
const Moon = chakra(MoonIcon, { baseStyle: { h: 4, w: 4 } });
const Sun = chakra(SunIcon, { baseStyle: { h: 4, w: 4 } });
const Check = chakra(CheckIcon, { baseStyle: { h: 4, w: 4 } });
const Shield = chakra(ShieldCheckIcon, {
	baseStyle: { h: 5, strokeWidth: "1.8px", w: 5 },
});
const CopyIcon = chakra(ClipboardDocumentIcon, {
	baseStyle: { h: 3.5, w: 3.5 },
});
const CopiedIcon = chakra(ClipboardDocumentCheckIcon, {
	baseStyle: { h: 3.5, w: 3.5 },
});

const THEME_KEY = "rb-theme";
const CHAKRA_THEME_KEY = "chakra-ui-color-mode";
const CUSTOM_THEMES_KEY = "rb-custom-themes";

type LoginThemeMode = "dark" | "light";

type LoginFormValues = {
	username: string;
	password: string;
};

type LoginFieldProps = {
	autoComplete: string;
	dir: "ltr" | "rtl";
	endElement?: ReactNode;
	errorMessage?: string;
	icon: ReactNode;
	label: string;
	placeholder: string;
	registration: UseFormRegisterReturn;
	type?: string;
};

const LoginField: FC<LoginFieldProps> = ({
	autoComplete,
	dir,
	endElement,
	errorMessage,
	icon,
	label,
	placeholder,
	registration,
	type = "text",
}) => {
	const isInvalid = Boolean(errorMessage);
	const fieldBg = useColorModeValue("white", "var(--rb-panel-main)");
	const borderColor = useColorModeValue(
		"var(--rb-panel-border)",
		"var(--rb-panel-border)",
	);
	const textColor = useColorModeValue(
		"var(--rb-panel-text)",
		"var(--rb-panel-text)",
	);
	const mutedColor = useColorModeValue(
		"var(--rb-panel-text-muted)",
		"var(--rb-panel-text-muted)",
	);

	return (
		<FormControl isInvalid={isInvalid}>
			<FormLabel
				color={textColor}
				fontSize="xs"
				fontWeight="600"
				letterSpacing="0.01em"
				mb={1.5}
			>
				{label}
			</FormLabel>
			<InputGroup dir={dir}>
				<InputLeftElement
					color={isInvalid ? "red.400" : mutedColor}
					h="44px"
					pointerEvents="none"
				>
					{icon}
				</InputLeftElement>
				<CInput
					{...registration}
					autoComplete={autoComplete}
					bg={fieldBg}
					borderColor={isInvalid ? "red.400" : borderColor}
					borderRadius="10px"
					color={textColor}
					fontSize="sm"
					h="44px"
					pe={endElement ? "3rem" : 4}
					placeholder={placeholder}
					ps="3rem"
					transition="border-color 160ms cubic-bezier(0.2, 0, 0, 1), box-shadow 160ms cubic-bezier(0.2, 0, 0, 1), background-color 160ms cubic-bezier(0.2, 0, 0, 1)"
					type={type}
					_placeholder={{ color: mutedColor }}
					_hover={{
						md: {
							borderColor: isInvalid
								? "red.400"
								: "var(--rb-panel-border-strong)",
						},
					}}
					_focusVisible={{
						borderColor: isInvalid ? "red.400" : "var(--rb-panel-accent)",
						boxShadow: isInvalid
							? "0 0 0 1px rgba(248, 113, 113, 0.6)"
							: "0 0 0 1px var(--rb-panel-accent)",
					}}
				/>
				{endElement && (
					<InputRightElement color={mutedColor} h="44px">
						{endElement}
					</InputRightElement>
				)}
			</InputGroup>
			<FormErrorMessage fontSize="xs" mt={1.5}>
				{errorMessage}
			</FormErrorMessage>
		</FormControl>
	);
};

const applyLoginThemeMode = (theme: LoginThemeMode) => {
	try {
		localStorage.setItem(THEME_KEY, theme);
		localStorage.setItem(CHAKRA_THEME_KEY, theme);
		localStorage.removeItem(CUSTOM_THEMES_KEY);
	} catch {}

	const targets = [document.documentElement, document.body].filter(
		Boolean,
	) as HTMLElement[];
	targets.forEach((target) => {
		target.classList.remove(
			"rb-theme-light",
			"rb-theme-dark",
			"chakra-ui-light",
			"chakra-ui-dark",
		);
		target.classList.add(`rb-theme-${theme}`, `chakra-ui-${theme}`);
		target.dataset.theme = theme;
		target.style.colorScheme = theme;
	});
	updateThemeColor(theme);
};

const LoginThemeMenu: FC = () => {
	const { t } = useTranslation();
	const { colorMode, setColorMode } = useColorMode();
	const activeTheme = colorMode === "light" ? "light" : "dark";
	const menuBg = useColorModeValue("panel.surface", "panel.surface");
	const menuBorder = useColorModeValue("panel.border", "panel.border");
	const hoverBg = useColorModeValue("panel.elevated", "panel.elevated");
	const textColor = useColorModeValue("panel.text", "panel.text");

	const selectTheme = (theme: LoginThemeMode) => {
		applyLoginThemeMode(theme);
		setColorMode(theme);
	};

	const options: Array<{
		key: LoginThemeMode;
		label: string;
		icon: ReactElement;
	}> = [
		{ key: "dark", label: t("theme.dark"), icon: <Moon /> },
		{ key: "light", label: t("theme.light"), icon: <Sun /> },
	];

	return (
		<Menu placement="bottom-end" strategy="fixed" autoSelect={false}>
			<MenuButton
				as={IconButton}
				aria-label={t("header.theme")}
				borderRadius="10px"
				h="36px"
				icon={activeTheme === "dark" ? <Moon /> : <Sun />}
				minH="36px"
				minW="36px"
				size="sm"
				variant="ghost"
				w="36px"
				_active={{ transform: "scale(0.96)" }}
				_hover={{
					md: {
						bg: hoverBg,
					},
				}}
			/>
			<Portal>
				<MenuList
					bg={menuBg}
					borderColor={menuBorder}
					borderRadius="14px"
					boxShadow="0 12px 36px rgba(0, 0, 0, 0.28)"
					color={textColor}
					minW="160px"
					p={1.5}
				>
					{options.map((option) => (
						<MenuItem
							borderRadius="8px"
							key={option.key}
							icon={option.icon}
							onClick={() => selectTheme(option.key)}
							_hover={{ bg: hoverBg }}
						>
							<HStack justify="space-between" w="full">
								<Text fontSize="sm">{option.label}</Text>
								{activeTheme === option.key ? <Check /> : null}
							</HStack>
						</MenuItem>
					))}
				</MenuList>
			</Portal>
		</Menu>
	);
};

export const Login: FC = () => {
	const [error, setError] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [step, setStep] = useState<"credentials" | "otp" | "setup">(
		"credentials",
	);
	const [otp, setOTP] = useState("");
	const [setup, setSetup] = useState<TOTPSetup | null>(null);
	const [challengeLoading, setChallengeLoading] = useState(false);
	const [copiedSecret, setCopiedSecret] = useState(false);
	const navigate = useNavigate();
	const { t, i18n } = useTranslation();
	const dir = i18n.language === "fa" ? "rtl" : "ltr";
	const pageBg = useColorModeValue(
		"var(--rb-panel-main)",
		"var(--rb-panel-main)",
	);
	const surfaceBg = useColorModeValue(
		"var(--rb-panel-surface)",
		"var(--rb-panel-surface)",
	);
	const elevatedBg = useColorModeValue(
		"var(--rb-panel-elevated)",
		"var(--rb-panel-elevated)",
	);
	const borderColor = useColorModeValue(
		"var(--rb-panel-border)",
		"var(--rb-panel-border)",
	);
	const textColor = useColorModeValue(
		"var(--rb-panel-text)",
		"var(--rb-panel-text)",
	);
	const mutedColor = useColorModeValue(
		"var(--rb-panel-text-muted)",
		"var(--rb-panel-text-muted)",
	);
	const logoFilter = useColorModeValue(
		"brightness(0)",
		"brightness(0) invert(1)",
	);
	const accentColor = "var(--rb-panel-accent)";
	const inputFieldBg = useColorModeValue("white", "var(--rb-panel-main)");
	const alertBg = useColorModeValue("red.50", "rgba(239, 68, 68, 0.12)");
	const alertBorder = useColorModeValue("red.200", "rgba(239, 68, 68, 0.3)");
	const alertColor = useColorModeValue("red.700", "red.300");

	const {
		register,
		formState: { errors, isSubmitting },
		handleSubmit,
		watch,
	} = useForm<LoginFormValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			password: "",
			username: "",
		},
	});

	const usernameValue = watch("username") || "";
	const passwordValue = watch("password") || "";
	const canSubmit =
		Boolean(usernameValue.trim().length) &&
		Boolean(passwordValue.trim().length) &&
		!isSubmitting;

	useEffect(() => {
		void usernameValue;
		void passwordValue;
		setError((current) => (current ? "" : current));
	}, [usernameValue, passwordValue]);

	useEffect(() => {
		getSession()
			.then(async (session) => {
				if (session.state === "active") {
					navigate("/");
				} else if (session.state === "disabled") {
					navigate("/users");
				} else if (session.state === "pending_2fa") {
					setStep("otp");
				} else {
					setSetup(await start2FASetup());
					setStep("setup");
				}
			})
			.catch(() => undefined);
	}, [navigate]);

	const completeLogin = () => {
		clearClientSession();
		navigate("/");
	};

	const openRequiredSetup = async () => {
		setSetup(await start2FASetup());
		setStep("setup");
	};

	const login = async (values: LoginFormValues) => {
		setError("");
		try {
			const session = await createSession(values.username, values.password);
			if (session.state === "pending_2fa") {
				setStep("otp");
				setOTP("");
			} else if (session.state === "setup_required") {
				await openRequiredSetup();
			} else if (session.state === "disabled") {
				clearClientSession();
				navigate("/users");
			} else {
				completeLogin();
			}
		} catch (err: any) {
			setError(err.response?._data?.detail || "Login failed");
		}
	};

	const submitOTP = async () => {
		setError("");
		setChallengeLoading(true);
		try {
			await verify2FA(otp);
			completeLogin();
		} catch (err: any) {
			setError(err.response?._data?.detail || "Invalid authentication code");
		} finally {
			setChallengeLoading(false);
		}
	};

	const confirmSetup = async () => {
		setError("");
		setChallengeLoading(true);
		try {
			await confirm2FASetup(otp);
			completeLogin();
		} catch (err: any) {
			setError(err.response?._data?.detail || "Invalid authentication code");
		} finally {
			setChallengeLoading(false);
		}
	};

	const cancelChallenge = async () => {
		try {
			await logout();
		} finally {
			setStep("credentials");
			setOTP("");
			setSetup(null);
			setError("");
		}
	};

	const handleInvalid = async (_errors: FieldErrors<LoginFormValues>) => {
		setError("");
	};

	const handleCopySecret = async () => {
		if (!setup?.secret) return;
		try {
			await navigator.clipboard.writeText(setup.secret);
			setCopiedSecret(true);
			setTimeout(() => setCopiedSecret(false), 2000);
		} catch {}
	};

	const passwordToggle = (
		<IconButton
			aria-label={
				showPassword
					? t("admins.hidePassword")
					: t("admins.showPassword")
			}
			borderRadius="8px"
			color={mutedColor}
			h="32px"
			icon={showPassword ? <EyeSlash /> : <Eye />}
			minH="32px"
			minW="32px"
			onClick={() => setShowPassword((visible) => !visible)}
			onMouseDown={(event) => event.preventDefault()}
			size="sm"
			variant="ghost"
			w="32px"
			_active={{ transform: "scale(0.92)" }}
			_hover={{
				base: { bg: "transparent" },
				md: { bg: elevatedBg, color: textColor },
			}}
		/>
	);

	return (
		<Box
			alignItems="center"
			bg={pageBg}
			display="flex"
			justifyContent="center"
			minH="100dvh"
			position="relative"
			px={{ base: 4, sm: 6 }}
			py={{ base: 8, sm: 12 }}
			w="full"
		>
			<VStack maxW="420px" spacing={6} w="full">
				<motion.div
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
					style={{ width: "100%" }}
				>
					<Box
						bg={surfaceBg}
						borderColor={borderColor}
						borderRadius="20px"
						borderWidth="1px"
						boxShadow="0 24px 64px -12px rgba(0, 0, 0, 0.32)"
						p={{ base: 6, sm: 8 }}
						position="relative"
						w="full"
					>
					<HStack justifyContent="space-between" mb={6} spacing={3}>
						<HStack color={textColor} minW={0} spacing={3}>
							<Box
								alignItems="center"
								bg={elevatedBg}
								borderColor={borderColor}
								borderRadius="12px"
								borderWidth="1px"
								display="inline-flex"
								flexShrink={0}
								h="42px"
								justifyContent="center"
								w="42px"
							>
								<LogoIcon
									alt={t("menu")}
									filter={logoFilter}
									src={logoUrl}
								/>
							</Box>
							<VStack align="start" spacing={0}>
								<Text fontSize="lg" fontWeight="800" letterSpacing="-0.02em" lineHeight="1.2">
									Rebecca
								</Text>
								<Text color={mutedColor} fontSize="2xs" fontWeight="500">
									Admin Panel
								</Text>
							</VStack>
						</HStack>
						<HStack flexShrink={0} spacing={1.5}>
							<Language triggerVariant="ghost" />
							<LoginThemeMenu />
						</HStack>
					</HStack>

					<VStack align="stretch" mb={6} spacing={1} textAlign="start">
						<Text color={textColor} fontSize="lg" fontWeight="700" letterSpacing="-0.01em">
							{step === "credentials"
								? t("login.welcome")
								: step === "otp"
									? t("login.twoFactorTitle")
									: t("login.setupTwoFactorTitle")}
						</Text>
						<Text color={mutedColor} fontSize="xs" lineHeight="1.5">
							{step === "credentials"
								? t("login.welcomeBack")
								: step === "otp"
									? t("login.twoFactorHint")
									: t("login.setupTwoFactorHint")}
						</Text>
					</VStack>

					<Box>
						<AnimatePresence initial={false} mode="wait">
							{step === "credentials" ? (
								<motion.div
									key="credentials-step"
									initial={{ opacity: 0, x: -12 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 12 }}
									transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
									style={{ width: "100%" }}
								>
									<form onSubmit={handleSubmit(login, handleInvalid)}>
										<VStack spacing={4}>
											<LoginField
												autoComplete="username"
												dir={dir}
												errorMessage={
													errors.username?.message
														? t(errors.username.message as string)
														: undefined
												}
												icon={<User />}
												label={t("username")}
												placeholder={t("username")}
												registration={register("username")}
											/>
											<LoginField
												autoComplete="current-password"
												dir={dir}
												endElement={passwordToggle}
												errorMessage={
													errors.password?.message
														? t(errors.password.message as string)
														: undefined
												}
												icon={<Lock />}
												label={t("password")}
												placeholder={t("password")}
												registration={register("password")}
												type={showPassword ? "text" : "password"}
											/>

											{error && (
												<Alert
													bg={alertBg}
													borderColor={alertBorder}
													borderRadius="10px"
													borderWidth="1px"
													color={alertColor}
													fontSize="xs"
													py={2.5}
													w="full"
												>
													<AlertIcon color="red.400" />
													<AlertDescription fontWeight="500">{error}</AlertDescription>
												</Alert>
											)}

											<Button
												bg={accentColor}
												borderRadius="10px"
												color="white"
												fontWeight="600"
												h="44px"
												isDisabled={!canSubmit}
												isLoading={isSubmitting}
												leftIcon={<LoginIcon />}
												mt={2}
												type="submit"
												w="full"
												transition="all 160ms cubic-bezier(0.2, 0, 0, 1)"
												_active={{ transform: "scale(0.98)" }}
												_hover={{
													md: {
														bg: "var(--rb-panel-accent-hover)",
													},
												}}
											>
												{t("login")}
											</Button>
										</VStack>
									</form>
								</motion.div>
							) : (
								<motion.div
									key="otp-step"
									initial={{ opacity: 0, x: 12 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -12 }}
									transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
									style={{ width: "100%" }}
								>
									<VStack spacing={4}>
										{step === "setup" && setup && (
											<VStack spacing={3} w="full">
												<Box
													alignItems="center"
													bg="white"
													borderRadius="14px"
													boxShadow="0 4px 16px rgba(0, 0, 0, 0.08)"
													display="flex"
													justifyContent="center"
													p={3}
												>
													<QRCodeCanvas value={setup.uri} size={168} />
												</Box>
												<HStack
													bg={elevatedBg}
													borderColor={borderColor}
													borderRadius="10px"
													borderWidth="1px"
													justify="space-between"
													px={3}
													py={2}
													w="full"
												>
													<Text
														color={textColor}
														fontFamily="mono"
														fontSize="xs"
														fontWeight="600"
														letterSpacing="0.05em"
														noOfLines={1}
													>
														{setup.secret}
													</Text>
													<Tooltip
														hasArrow
														label={copiedSecret ? t("copied") : t("copy")}
														placement="top"
													>
														<IconButton
															aria-label={t("copy")}
															borderRadius="8px"
															color={copiedSecret ? "green.400" : mutedColor}
															h="28px"
															icon={copiedSecret ? <CopiedIcon /> : <CopyIcon />}
															minH="28px"
															minW="28px"
															onClick={handleCopySecret}
															size="xs"
															variant="ghost"
															w="28px"
															_hover={{
																md: {
																	bg: surfaceBg,
																	color: textColor,
																},
															}}
														/>
													</Tooltip>
												</HStack>
											</VStack>
										)}

										<FormControl>
											<FormLabel
												color={textColor}
												fontSize="xs"
												fontWeight="600"
												letterSpacing="0.01em"
												mb={1.5}
											>
												{t("login.authenticationCode")}
											</FormLabel>
											<InputGroup dir="ltr">
												<InputLeftElement
													color={mutedColor}
													h="44px"
													pointerEvents="none"
												>
													<Shield />
												</InputLeftElement>
												<CInput
													autoComplete="one-time-code"
													bg={inputFieldBg}
													borderColor={borderColor}
													borderRadius="10px"
													color={textColor}
													fontFamily="mono"
													fontSize="lg"
													fontWeight="700"
													h="44px"
													inputMode="numeric"
													letterSpacing="0.32em"
													maxLength={6}
													ps="3rem"
													textAlign="center"
													transition="border-color 160ms cubic-bezier(0.2, 0, 0, 1), box-shadow 160ms cubic-bezier(0.2, 0, 0, 1)"
													value={otp}
													onChange={(event) =>
														setOTP(event.target.value.replace(/\D/g, ""))
													}
													_hover={{
														md: {
															borderColor: "var(--rb-panel-border-strong)",
														},
													}}
													_focusVisible={{
														borderColor: "var(--rb-panel-accent)",
														boxShadow: "0 0 0 1px var(--rb-panel-accent)",
													}}
												/>
											</InputGroup>
										</FormControl>

										{error && (
											<Alert
												bg={alertBg}
												borderColor={alertBorder}
												borderRadius="10px"
												borderWidth="1px"
												color={alertColor}
												fontSize="xs"
												py={2.5}
												w="full"
											>
												<AlertIcon color="red.400" />
												<AlertDescription fontWeight="500">{error}</AlertDescription>
											</Alert>
										)}

										<Button
											bg={accentColor}
											borderRadius="10px"
											color="white"
											fontWeight="600"
											h="44px"
											isDisabled={otp.length !== 6}
											isLoading={challengeLoading}
											onClick={step === "otp" ? submitOTP : confirmSetup}
											w="full"
											transition="all 160ms cubic-bezier(0.2, 0, 0, 1)"
											_active={{ transform: "scale(0.98)" }}
											_hover={{
												md: {
													bg: "var(--rb-panel-accent-hover)",
												},
											}}
										>
											{t("continue")}
										</Button>
										<Button
											borderRadius="10px"
											color={mutedColor}
											fontWeight="500"
											h="38px"
											onClick={cancelChallenge}
											variant="ghost"
											w="full"
											_active={{ transform: "scale(0.98)" }}
											_hover={{
												md: {
													bg: elevatedBg,
													color: textColor,
												},
											}}
										>
											{t("back")}
										</Button>
									</VStack>
								</motion.div>
							)}
						</AnimatePresence>
					</Box>
				</Box>
				</motion.div>
			</VStack>
		</Box>
	);
};

export default Login;
