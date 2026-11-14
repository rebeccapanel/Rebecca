import { zodResolver } from "@hookform/resolvers/zod";
import logoUrl from "assets/logo.svg";
import { Language } from "components/Language";
import { Button } from "components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "components/ui/dropdown-menu";
import {
	InputOTP,
	InputOTPSeparator,
	InputOTPSlot,
} from "components/ui/input-otp";
import { useColorMode } from "lib/color-mode";
import { cn } from "lib/cn";
import { AnimatePresence, motion } from "framer-motion";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CircleAlert,
	Copy,
	Eye,
	EyeOff,
	Moon,
	QrCode,
	ShieldCheck,
	Sun,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";
import {
	type FieldErrors,
	useForm,
	type UseFormRegisterReturn,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
	confirm2FASetup,
	getSession,
	login as createSession,
	logout,
	start2FASetup,
	type TOTPSetup,
	verify2FA,
} from "service/auth";
import { toast } from "sonner";
import { clearClientSession } from "utils/session";
import { updateThemeColor } from "utils/themeColor";
import { z } from "zod";

const credentialsSchema = z.object({
	username: z.string().min(1, "login.fieldRequired"),
	password: z.string().min(1, "login.fieldRequired"),
});

const THEME_KEY = "rb-theme";
const CHAKRA_THEME_KEY = "chakra-ui-color-mode";
const CUSTOM_THEMES_KEY = "rb-custom-themes";

type LoginThemeMode = "dark" | "light";

type LoginFormValues = {
	username: string;
	password: string;
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

interface LoginFieldProps {
	id: string;
	label: string;
	type?: string;
	placeholder?: string;
	autoComplete: string;
	dir: "ltr" | "rtl";
	registration: UseFormRegisterReturn;
	icon?: ReactNode;
	errorMessage?: string;
	endElement?: ReactNode;
}

const LoginField: FC<LoginFieldProps> = ({
	id,
	label,
	type = "text",
	placeholder,
	autoComplete,
	dir,
	registration,
	icon,
	errorMessage,
	endElement,
}) => {
	const invalid = Boolean(errorMessage);

	return (
		<div className="flex flex-col gap-1.5 text-start">
			<label
				htmlFor={id}
				className="text-[12px] font-semibold text-panel-text-secondary select-none"
			>
				{label}
			</label>
			<div className="relative w-full" dir={dir}>
				{icon ? (
					<span
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 transition-colors duration-150",
							invalid ? "text-red-500" : "text-panel-text-muted",
						)}
					>
						{icon}
					</span>
				) : null}
				<input
					{...registration}
					id={id}
					type={type}
					autoComplete={autoComplete}
					aria-invalid={invalid || undefined}
					placeholder={placeholder}
					className={cn(
						"h-11 w-full rounded-[14px] border bg-panel-elevated/40 text-[14px] text-panel-text outline-none transition-[border-color,background-color,box-shadow,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] select-text placeholder:text-panel-text-muted/40 [touch-action:manipulation]",
						icon ? "ps-10" : "ps-3.5",
						endElement ? "pe-11" : "pe-3.5",
						invalid
							? "border-red-500! bg-red-500/5 focus-visible:ring-2 focus-visible:ring-red-500/30"
							: "border-panel-border! hover:border-panel-border-strong! focus-visible:border-panel-accent! focus-visible:bg-panel-elevated/80 focus-visible:ring-2 focus-visible:ring-panel-accent/40",
					)}
				/>
				{endElement ? (
					<div className="absolute end-1.5 top-1/2 -translate-y-1/2">
						{endElement}
					</div>
				) : null}
			</div>
			{errorMessage ? (
				<p
					role="alert"
					className="text-[12px] font-medium text-red-500 [overflow-wrap:anywhere]"
				>
					{errorMessage}
				</p>
			) : null}
		</div>
	);
};

const LoginThemeMenu: FC = () => {
	const { t } = useTranslation();
	const { colorMode, setColorMode } = useColorMode();
	const activeTheme: LoginThemeMode = colorMode === "light" ? "light" : "dark";

	const selectTheme = (theme: LoginThemeMode) => {
		applyLoginThemeMode(theme);
		setColorMode(theme);
	};

	const options: Array<{
		key: LoginThemeMode;
		label: string;
		icon: ReactNode;
	}> = [
		{ key: "dark", label: t("theme.dark"), icon: <Moon className="size-4" /> },
		{ key: "light", label: t("theme.light"), icon: <Sun className="size-4" /> },
	];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					aria-label={t("header.theme")}
					variant="ghost"
					size="icon-sm"
					className="size-9 rounded-[12px] text-panel-text-muted transition-colors hover:text-panel-text"
				>
					{activeTheme === "dark" ? (
						<Moon className="size-4" />
					) : (
						<Sun className="size-4" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={8}
				className="z-[9999] min-w-36 rounded-[16px] border border-panel-border! bg-panel-surface p-1.5 text-panel-text shadow-[0_12px_32px_rgba(0,0,0,0.24)] select-none"
			>
				{options.map((option) => (
					<DropdownMenuItem
						key={option.key}
						onSelect={() => selectTheme(option.key)}
						className={cn(
							"flex cursor-pointer items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-[background-color,transform] duration-150 active:scale-[0.98] min-[769px]:hover:bg-panel-elevated",
							activeTheme === option.key
								? "bg-panel-elevated/70 font-semibold text-panel-text"
								: "font-medium text-panel-text-secondary",
						)}
					>
						<span className="flex items-center gap-2">
							{option.icon}
							<span>{option.label}</span>
						</span>
						{activeTheme === option.key ? (
							<Check className="size-3.5 text-panel-accent" />
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

export const Login: FC = () => {
	const [error, setError] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [step, setStep] = useState<"credentials" | "otp" | "setup">("credentials");
	const [otp, setOTP] = useState("");
	const [setup, setSetup] = useState<TOTPSetup | null>(null);
	const [challengeLoading, setChallengeLoading] = useState(false);
	const [copiedSecret, setCopiedSecret] = useState(false);
	const qrId = useId();

	const navigate = useNavigate();
	const { t, i18n } = useTranslation();
	const { colorMode } = useColorMode();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const dir = isRTL ? "rtl" : "ltr";

	const {
		register,
		formState: { errors, isSubmitting },
		handleSubmit,
		watch,
	} = useForm<LoginFormValues>({
		resolver: zodResolver(credentialsSchema),
		defaultValues: { password: "", username: "" },
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
		setError("");
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

	const completeLogin = useCallback(() => {
		clearClientSession();
		navigate("/");
	}, [navigate]);

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
		} catch (err: unknown) {
			const detail = (err as { response?: { _data?: { detail?: string } } })
				?.response?._data?.detail;
			setError(detail || t("login.invalidCredentials", "Invalid username or password"));
		}
	};

	const submitOTP = useCallback(
		async (codeToSubmit?: string) => {
			const targetCode = codeToSubmit ?? otp;
			if (targetCode.length !== 6 || challengeLoading) return;
			setError("");
			setChallengeLoading(true);
			try {
				await verify2FA(targetCode);
				completeLogin();
			} catch (err: unknown) {
				const detail = (err as { response?: { _data?: { detail?: string } } })
					?.response?._data?.detail;
				setError(detail || t("login.invalidCode", "Invalid authentication code"));
			} finally {
				setChallengeLoading(false);
			}
		},
		[otp, challengeLoading, t, completeLogin],
	);

	const confirmSetup = useCallback(
		async (codeToSubmit?: string) => {
			const targetCode = codeToSubmit ?? otp;
			if (targetCode.length !== 6 || challengeLoading) return;
			setError("");
			setChallengeLoading(true);
			try {
				await confirm2FASetup(targetCode);
				completeLogin();
			} catch (err: unknown) {
				const detail = (err as { response?: { _data?: { detail?: string } } })
					?.response?._data?.detail;
				setError(detail || t("login.invalidCode", "Invalid authentication code"));
			} finally {
				setChallengeLoading(false);
			}
		},
		[otp, challengeLoading, t, completeLogin],
	);

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

	const copySecret = () => {
		if (!setup?.secret) return;
		navigator.clipboard.writeText(setup.secret);
		setCopiedSecret(true);
		toast.success(t("copied", "Copied to clipboard"));
		window.setTimeout(() => setCopiedSecret(false), 2000);
	};

	const handleInvalid = async (_fieldErrors: FieldErrors<LoginFormValues>) => {
		setError("");
	};

	const title =
		step === "credentials"
			? t("login.welcome")
			: step === "otp"
				? t("login.twoFactorTitle")
				: t("login.setupTwoFactorTitle");
	const subtitle =
		step === "credentials"
			? t("login.welcomeBack")
			: step === "otp"
				? t("login.twoFactorHint")
				: t("login.setupTwoFactorHint");

	return (
		<div
			dir={dir}
			className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-panel-main px-4 py-8 select-none [touch-action:manipulation] sm:px-6 md:py-12"
		>
			<div className="relative w-full max-w-[420px]">
				<div className="relative overflow-hidden rounded-[24px] border border-panel-border! bg-panel-surface p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.32),inset_0_1px_0_0_rgba(255,255,255,0.7)] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] sm:p-8 dark:shadow-[0_28px_72px_-16px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.08)]">
					<div className="mb-8 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-panel-border/80! bg-panel-elevated/80 shadow-[0_1px_2px_rgba(0,0,0,0.06),inset_0_1px_0_0_rgba(255,255,255,0.08)]">
								<img
									src={logoUrl}
									alt=""
									aria-hidden="true"
									draggable={false}
									loading="eager"
									decoding="sync"
									style={{
										filter:
											colorMode === "dark"
												? "brightness(0) invert(1)"
												: "brightness(0)",
									}}
									className="pointer-events-none size-6 object-contain select-none [-webkit-user-drag:none]"
								/>
							</div>
							<div className="flex flex-col text-start">
								<span className="font-heading text-[17px] font-bold tracking-tight text-panel-text leading-tight">
									Rebecca
								</span>
								<span className="text-[11px] font-medium tracking-wide text-panel-text-muted">
									Panel
								</span>
							</div>
						</div>

						<div className="flex items-center gap-1 text-panel-text-muted">
							<Language triggerVariant="ghost" />
							<LoginThemeMenu />
						</div>
					</div>

					<div className="mb-7 flex flex-col items-start gap-1 text-start">
						<h1 className="font-heading text-[22px] font-bold tracking-tight text-panel-text sm:text-[24px]">
							{title}
						</h1>
						<p className="text-[13px] leading-relaxed text-panel-text-secondary sm:text-[14px]">
							{subtitle}
						</p>
					</div>

					<AnimatePresence mode="wait" initial={false}>
						{step === "credentials" ? (
							<motion.div
								key="credentials-step"
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -10 }}
								transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
							>
								<form
									onSubmit={handleSubmit(login, handleInvalid)}
									className="flex flex-col gap-4"
								>
									<LoginField
										id="login-username"
										label={t("username")}
										autoComplete="username"
										dir={dir}
										registration={register("username")}
										errorMessage={
											errors.username?.message
												? t(errors.username.message as string)
												: undefined
										}
									/>

									<LoginField
										id="login-password"
										label={t("password")}
										type={showPassword ? "text" : "password"}
										autoComplete="current-password"
										dir={dir}
										registration={register("password")}
										errorMessage={
											errors.password?.message
												? t(errors.password.message as string)
												: undefined
										}
										endElement={
											<button
												type="button"
												aria-label={
													showPassword
														? t("admins.hidePassword")
														: t("admins.showPassword")
												}
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => setShowPassword((v) => !v)}
												className="inline-flex size-8 items-center justify-center rounded-[8px] text-panel-text-muted transition-colors hover:text-panel-text active:scale-95"
											>
												{showPassword ? (
													<EyeOff className="size-4" />
												) : (
													<Eye className="size-4" />
												)}
											</button>
										}
									/>

									{error ? (
										<motion.div
											initial={{ opacity: 0, y: -4 }}
											animate={{ opacity: 1, y: 0 }}
											role="alert"
											className="flex items-start gap-2.5 rounded-[12px] border border-red-500/20 bg-red-500/10 p-3 text-[13px] font-medium text-red-500"
										>
											<CircleAlert className="mt-0.5 size-4 shrink-0" />
											<span className="flex-1 leading-snug text-start">
												{error}
											</span>
										</motion.div>
									) : null}

									<Button
										type="submit"
										disabled={!canSubmit}
										loading={isSubmitting}
										className="mt-2 h-11 w-full rounded-[14px] bg-panel-accent text-[14px] font-semibold text-white shadow-xs transition-all active:scale-[0.98] min-[769px]:hover:bg-panel-accent-hover"
									>
										<span>{isSubmitting ? t("login.loading") : t("login")}</span>
									</Button>
								</form>
							</motion.div>
						) : (
							<motion.div
								key="challenge-step"
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -10 }}
								transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
								className="flex flex-col gap-4"
							>
								{step === "setup" && setup ? (
									<div className="flex flex-col items-center gap-3 rounded-[16px] border border-panel-border! bg-panel-elevated/40 p-4">
										<div
											id={qrId}
											className="relative flex items-center justify-center overflow-hidden rounded-[14px] border border-panel-border! bg-white p-2.5 shadow-xs"
										>
											<QRCodeCanvas
												value={setup.uri}
												size={160}
												marginSize={1}
												bgColor="#ffffff"
												fgColor="#0a0a0a"
											/>
										</div>
										<div className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-panel-border! bg-panel-surface px-3 py-2 text-start">
											<div className="flex min-w-0 flex-1 flex-col">
												<span className="text-[11px] font-medium text-panel-text-muted">
													{t("myaccount.secretKey", "Secret key")}
												</span>
												<code
													dir="ltr"
													className="truncate font-mono text-[12px] font-semibold text-panel-text select-all"
												>
													{setup.secret}
												</code>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												onClick={copySecret}
												aria-label={t("copy", "Copy")}
												className="size-8 shrink-0 rounded-[8px] text-panel-text-muted hover:text-panel-text"
											>
												{copiedSecret ? (
													<Check className="size-4 text-emerald-500" />
												) : (
													<Copy className="size-4" />
												)}
											</Button>
										</div>
									</div>
								) : null}

								<div className="flex flex-col items-center gap-2">
									<label
										htmlFor="login-otp"
										className="text-[12px] font-semibold text-panel-text-secondary select-none"
									>
										{t("login.authenticationCode")}
									</label>

									<InputOTP
										id="login-otp"
										value={otp}
										disabled={challengeLoading}
										aria-invalid={Boolean(error) || undefined}
										onValueChange={(val) => {
											setOTP(val);
											setError("");
											if (val.length === 6) {
												if (step === "otp") {
													submitOTP(val);
												} else {
													confirmSetup(val);
												}
											}
										}}
									>
										<InputOTPSlot index={0} />
										<InputOTPSlot index={1} />
										<InputOTPSlot index={2} />
										<InputOTPSeparator />
										<InputOTPSlot index={3} />
										<InputOTPSlot index={4} />
										<InputOTPSlot index={5} />
									</InputOTP>
								</div>

								{error ? (
									<motion.div
										initial={{ opacity: 0, y: -4 }}
										animate={{ opacity: 1, y: 0 }}
										role="alert"
										className="flex items-start gap-2.5 rounded-[12px] border border-red-500/20 bg-red-500/10 p-3 text-[13px] font-medium text-red-500"
									>
										<CircleAlert className="mt-0.5 size-4 shrink-0" />
										<span className="flex-1 leading-snug text-start">
											{error}
										</span>
									</motion.div>
								) : null}

								<div className="mt-2 flex flex-col gap-2">
									<Button
										type="button"
										onClick={() =>
											step === "otp" ? submitOTP() : confirmSetup()
										}
										disabled={otp.length !== 6 || challengeLoading}
										loading={challengeLoading}
										className="h-11 w-full rounded-[14px] bg-panel-accent text-[14px] font-semibold text-white shadow-xs transition-all active:scale-[0.98] min-[769px]:hover:bg-panel-accent-hover"
									>
										{step === "otp" ? (
											<ShieldCheck className="size-4" />
										) : (
											<QrCode className="size-4" />
										)}
										<span>{t("continue")}</span>
									</Button>
									<Button
										type="button"
										variant="ghost"
										onClick={cancelChallenge}
										disabled={challengeLoading}
										className="h-10 w-full rounded-[14px] text-[13px] font-medium text-panel-text-muted hover:text-panel-text"
									>
										{isRTL ? (
											<ArrowRight className="size-3.5" />
										) : (
											<ArrowLeft className="size-3.5" />
										)}
										<span>{t("back")}</span>
									</Button>
								</div>
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
};

export default Login;
