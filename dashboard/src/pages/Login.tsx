import {
	Alert,
	AlertDescription,
	AlertIcon,
	Box,
	Button,
	Card,
	CardBody,
	Input as CInput,
	chakra,
	FormControl,
	FormErrorMessage,
	HStack,
	IconButton,
	InputGroup,
	InputRightElement,
	Text,
	useColorMode,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowRightOnRectangleIcon,
	EyeIcon,
	EyeSlashIcon,
} from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import logoUrl from "assets/logo.svg";
import { Input } from "components/Input";
import { Language } from "components/Language";
import ThemeSelector from "components/ThemeSelector";
import { type FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fetch } from "service/http";
import { removeAuthToken, setAuthToken } from "utils/authStorage";
import { z } from "zod";

const schema = z.object({
	username: z.string().min(1, "login.fieldRequired"),
	password: z.string().min(1, "login.fieldRequired"),
});

export const LogoIcon = chakra("img", {
	baseStyle: {
		w: 12,
		h: 12,
	},
});

const LoginIcon = chakra(ArrowRightOnRectangleIcon, {
	baseStyle: {
		w: 5,
		h: 5,
		strokeWidth: "2px",
	},
});

const Eye = chakra(EyeIcon, { baseStyle: { w: 4, h: 4 } });
const EyeSlash = chakra(EyeSlashIcon, { baseStyle: { w: 4, h: 4 } });

type LoginFormValues = {
	username: string;
	password: string;
};

export const Login: FC = () => {
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const navigate = useNavigate();
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";
	const basePad = "0.75rem";
	const endPadding = isRTL
		? { paddingInlineStart: "2.75rem", paddingInlineEnd: basePad }
		: { paddingInlineEnd: "2.75rem", paddingInlineStart: basePad };
	const endAdornmentProps = isRTL
		? {
				insetInlineStart: "0.5rem",
				insetInlineEnd: "auto",
				right: "auto",
				left: "0.5rem",
			}
		: {
				insetInlineEnd: "0.5rem",
				insetInlineStart: "auto",
				right: "0.5rem",
				left: "auto",
			};
	const { colorMode } = useColorMode();
	// slightly off-white in light mode so the card is visible against a plain white page
	// const cardBg = useColorModeValue("gray.50", "gray.700");
	// const cardBorder = useColorModeValue("gray.200", "gray.600");
	const location = useLocation();
	const {
		register,
		formState: { errors },
		handleSubmit,
		watch,
		trigger,
	} = useForm<LoginFormValues>({
		resolver: zodResolver(schema),
	});
	const usernameValue = watch("username") || "";
	const passwordValue = watch("password") || "";
	const canSubmit =
		Boolean(usernameValue.trim().length) && Boolean(passwordValue.trim().length);

	// Only clear existing tokens on initial mount to avoid wiping the new token
	useEffect(() => {
		removeAuthToken();
		if (location.pathname !== "/login") {
			navigate("/login", { replace: true });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const login = (values: LoginFormValues) => {
		setError("");
		const formData = new FormData();
		formData.append("username", values.username);
		formData.append("password", values.password);
		formData.append("grant_type", "password");
		setLoading(true);
		fetch("/admin/token", { method: "post", body: formData })
			.then(({ access_token: token }) => {
				console.log("Token received:", token);
				setAuthToken(token);
				navigate("/");
			})
			.catch((err) => {
				setError(err.response?._data?.detail || "Login failed");
			})
			.finally(() => setLoading(false));
	};

	const handleLoginClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
		// Prevent submit when fields are empty and surface validation errors
		const valid = await trigger(["username", "password"], { shouldFocus: true });
		if (!valid) {
			event.preventDefault();
			return;
		}
		handleSubmit(login)(event);
	};

	return (
		<VStack justifyContent="center" minH="100vh" p="6" w="full">
			<Card
				maxW="500px"
				w="full"
				bg="surface.light"
				_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
				borderWidth="1px"
				borderColor="light-border"
				boxShadow="md"
			>
				<CardBody>
					<HStack justifyContent="end" spacing={2} mb={6}>
						<Language />
						<ThemeSelector minimal />
					</HStack>
					<VStack alignItems="center" w="full" spacing={4}>
						<LogoIcon
							src={logoUrl}
							alt={t("appName") || "Rebecca"}
							filter={colorMode === "dark" ? "brightness(0) invert(1)" : "none"}
						/>
						<Text fontSize="2xl" fontWeight="semibold">
							{t("login.loginYourAccount")}
						</Text>
						<Text color="gray.600" _dark={{ color: "gray.400" }}>
							{t("login.welcomeBack")}
						</Text>
					</VStack>
					<Box w="full" pt="4">
						<form onSubmit={handleSubmit(login)}>
							<VStack spacing={4}>
								<FormControl isInvalid={!!errors.username}>
									<Input
										w="full"
										placeholder={t("username")}
										{...register("username")}
									/>
									<FormErrorMessage>
										{errors.username?.message
											? t(errors.username.message as string)
											: ""}
									</FormErrorMessage>
								</FormControl>
								<FormControl isInvalid={!!errors.password}>
									<InputGroup dir={isRTL ? "rtl" : "ltr"}>
										<CInput
											w="full"
											type={showPassword ? "text" : "password"}
											placeholder={t("password")}
											{...register("password")}
											{...endPadding}
										/>
										<InputRightElement
											insetInlineEnd={endAdornmentProps.insetInlineEnd}
											insetInlineStart={endAdornmentProps.insetInlineStart}
											right={endAdornmentProps.right}
											left={endAdornmentProps.left}
										>
											<IconButton
												aria-label={
													showPassword
														? t("admins.hidePassword", "Hide")
														: t("admins.showPassword", "Show")
												}
												size="sm"
												variant="ghost"
												onClick={() => setShowPassword(!showPassword)}
												icon={showPassword ? <EyeSlash /> : <Eye />}
											/>
										</InputRightElement>
									</InputGroup>
									<FormErrorMessage>
										{errors.password?.message
											? t(errors.password.message as string)
											: ""}
									</FormErrorMessage>
								</FormControl>
								{error && (
									<Alert status="error" rounded="md">
										<AlertIcon />
										<AlertDescription>{error}</AlertDescription>
									</Alert>
								)}
								<Button
									isLoading={loading}
									type="submit"
									w="full"
									colorScheme="primary"
									onClick={handleLoginClick}
									aria-disabled={!canSubmit}
									opacity={!canSubmit ? 0.7 : 1}
									cursor={!canSubmit ? "not-allowed" : "pointer"}
								>
									{<LoginIcon marginRight={1} />}
									{t("login")}
								</Button>
							</VStack>
						</form>
					</Box>
				</CardBody>
			</Card>
		</VStack>
	);
};

export default Login;
