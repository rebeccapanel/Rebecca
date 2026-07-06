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
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowRightOnRectangleIcon,
	CheckIcon,
	EyeIcon,
	EyeSlashIcon,
	LockClosedIcon,
	MoonIcon,
	SunIcon,
	UserIcon,
} from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import logoUrl from "assets/logo.svg";
import { Language } from "components/Language";
import {
	type FC,
	type ReactElement,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type FieldErrors,
	useForm,
	type UseFormRegisterReturn,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fetch } from "service/http";
import { setAuthToken } from "utils/authStorage";
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
				fontSize="sm"
				fontWeight="700"
				letterSpacing="0"
				mb={2}
			>
				{label}
			</FormLabel>
			<InputGroup dir={dir}>
				<InputLeftElement color={isInvalid ? "red.400" : mutedColor} h="44px">
					{icon}
				</InputLeftElement>
				<CInput
					{...registration}
					autoComplete={autoComplete}
					bg={fieldBg}
					borderColor={isInvalid ? "red.400" : borderColor}
					borderRadius="8px"
					color={textColor}
					fontSize="sm"
					h="44px"
					pe={endElement ? "3rem" : 4}
					placeholder={placeholder}
					ps="3rem"
					type={type}
					_placeholder={{ color: mutedColor }}
					_hover={{
						borderColor: isInvalid
							? "red.400"
							: "var(--rb-panel-border-strong)",
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
			<FormErrorMessage fontSize="xs">{errorMessage}</FormErrorMessage>
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
		{ key: "dark", label: t("theme.dark", "Dark"), icon: <Moon /> },
		{ key: "light", label: t("theme.light", "Light"), icon: <Sun /> },
	];

	return (
		<Menu placement="bottom-end" strategy="fixed" autoSelect={false}>
			<MenuButton
				as={IconButton}
				aria-label={t("theme.title", "Theme")}
				icon={activeTheme === "dark" ? <Moon /> : <Sun />}
				size="sm"
				variant="ghost"
			/>
			<Portal>
				<MenuList
					bg={menuBg}
					borderColor={menuBorder}
					color={textColor}
					minW="150px"
					p={1}
				>
					{options.map((option) => (
						<MenuItem
							key={option.key}
							icon={option.icon}
							onClick={() => selectTheme(option.key)}
							_hover={{ bg: hoverBg }}
						>
							<HStack justify="space-between" w="full">
								<Text>{option.label}</Text>
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
	const navigate = useNavigate();
	const { t, i18n } = useTranslation();
	const location = useLocation();
	const didCompleteLoginRef = useRef(false);
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
		if (didCompleteLoginRef.current) {
			return;
		}
		clearClientSession();
		if (location.pathname !== "/login") {
			navigate("/login", { replace: true });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.pathname, navigate]);

	useEffect(() => {
		if (error) {
			setError("");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [usernameValue, passwordValue]);

	const login = async (values: LoginFormValues) => {
		setError("");
		const formData = new URLSearchParams();
		formData.set("username", values.username);
		formData.set("password", values.password);
		formData.set("grant_type", "password");

		try {
			const { access_token: token } = await fetch<{ access_token: string }>(
				"/admin/token",
				{
					body: formData,
					headers: {
						"content-type": "application/x-www-form-urlencoded",
					},
					method: "post",
				},
			);
			clearClientSession();
			setAuthToken(token);
			didCompleteLoginRef.current = true;
			navigate("/");
		} catch (err: any) {
			setError(err.response?._data?.detail || "Login failed");
		}
	};

	const handleInvalid = async (_errors: FieldErrors<LoginFormValues>) => {
		setError("");
	};

	const passwordToggle = (
		<IconButton
			aria-label={
				showPassword
					? t("admins.hidePassword", "Hide")
					: t("admins.showPassword", "Show")
			}
			color={mutedColor}
			icon={showPassword ? <EyeSlash /> : <Eye />}
			onClick={() => setShowPassword((visible) => !visible)}
			onMouseDown={(event) => event.preventDefault()}
			size="sm"
			variant="ghost"
			_hover={{ bg: "transparent", color: textColor }}
		/>
	);

	return (
		<Box
			alignItems="center"
			bg={pageBg}
			display="flex"
			justifyContent="center"
			minH="100dvh"
			px={{ base: 4, md: 10 }}
			py={{ base: 6, md: 10 }}
			w="full"
		>
			<VStack maxW="400px" spacing={6} w="full">
				<Box
					bg={surfaceBg}
					borderColor={borderColor}
					borderRadius="8px"
					borderWidth="1px"
					boxShadow="0 18px 60px rgba(0, 0, 0, 0.22)"
					p={{ base: 5, sm: 6 }}
					w="full"
				>
					<HStack justifyContent="space-between" mb={7} spacing={3}>
						<HStack color={textColor} minW={0} spacing={3}>
							<Box
								alignItems="center"
								bg={elevatedBg}
								borderColor={borderColor}
								borderRadius="8px"
								borderWidth="1px"
								display="inline-flex"
								flexShrink={0}
								h={10}
								justifyContent="center"
								w={10}
							>
								<LogoIcon
									alt={t("appName", "Rebecca")}
									filter={logoFilter}
									src={logoUrl}
								/>
							</Box>
							<Text fontSize="lg" fontWeight="800" noOfLines={1}>
								Rebecca
							</Text>
						</HStack>
						<HStack flexShrink={0} spacing={2}>
							<Language triggerVariant="ghost" />
							<LoginThemeMenu />
						</HStack>
					</HStack>

					<VStack align="stretch" spacing={1} textAlign="center">
						<Text color={textColor} fontSize="lg" fontWeight="800">
							{t("login.welcome", "Welcome Back")}
						</Text>
						<Text color={mutedColor} fontSize="sm">
							{t(
								"login.welcomeBack",
								"Enter your credentials to access your account.",
							)}
						</Text>
					</VStack>

					<Box mt={6}>
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
										borderRadius="8px"
										fontSize="sm"
										status="error"
										variant="left-accent"
										w="full"
									>
										<AlertIcon />
										<AlertDescription>{error}</AlertDescription>
									</Alert>
								)}

								<Button
									bg={accentColor}
									borderRadius="8px"
									color="white"
									h="44px"
									isDisabled={!canSubmit}
									isLoading={isSubmitting}
									leftIcon={<LoginIcon />}
									mt={1}
									type="submit"
									w="full"
									_hover={{ bg: "var(--rb-panel-accent-hover)" }}
									_active={{ transform: "translateY(1px)" }}
								>
									{t("login", "Login")}
								</Button>
							</VStack>
						</form>
					</Box>
				</Box>
			</VStack>
		</Box>
	);
};

export default Login;
