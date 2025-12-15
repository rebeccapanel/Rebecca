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
import { type FieldValues, useForm } from "react-hook-form";
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
		? { insetInlineStart: "0.5rem", insetInlineEnd: "auto", right: "auto", left: "0.5rem" }
		: { insetInlineEnd: "0.5rem", insetInlineStart: "auto", right: "0.5rem", left: "auto" };
	const { colorMode } = useColorMode();
	// slightly off-white in light mode so the card is visible against a plain white page
	// const cardBg = useColorModeValue("gray.50", "gray.700");
	// const cardBorder = useColorModeValue("gray.200", "gray.600");
	const location = useLocation();
	const {
		register,
		formState: { errors },
		handleSubmit,
	} = useForm({
		resolver: zodResolver(schema),
	});
	useEffect(() => {
		removeAuthToken();
		if (location.pathname !== "/login") {
			navigate("/login", { replace: true });
		}
	}, [location.pathname, navigate]);
	const login = (values: FieldValues) => {
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
								<FormControl>
									<Input
										w="full"
										placeholder={t("username")}
										{...register("username")}
										error={t(errors?.username?.message as string)}
									/>
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
										{errors.password?.message as string}
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
