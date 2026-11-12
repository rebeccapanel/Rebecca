import { Button } from "components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { LogIn, Check, Eye, EyeOff, Lock, Moon, Sun, User } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useColorMode } from "lib/color-mode";
import logoUrl from "assets/logo.svg";
import { Language } from "components/Language";

import { cn } from "lib/cn";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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

type LoginFieldProps = {
	autoComplete: string;
	dir: "ltr" | "rtl";
	endElement?: ReactNode;
	errorMessage?: string;
	icon: ReactNode;
	id: string;
	label: string;
	placeholder: string;
	registration: UseFormRegisterReturn;
	type?: string;
};

/**
 * One labelled field. Tailwind + the panel tokens only — no Chakra, no `sx`.
 * The invalid state is carried by `aria-invalid` and a data attribute so the
 * styles stay declarative.
 */
function LoginField({
	autoComplete,
	dir,
	endElement,
	errorMessage,
	icon,
	id,
	label,
	placeholder,
	registration,
	type = "text",
}: LoginFieldProps) {
	const invalid = Boolean(errorMessage);

	return (
		<div className="space-y-2">
			<label htmlFor={id} className="block text-sm font-bold text-panel-text">
				{label}
			</label>
			<div className="relative" dir={dir}>
				<span
					className={cn(
						"pointer-events-none absolute start-3 top-1/2 -translate-y-1/2",
						invalid ? "text-panel-danger" : "text-panel-text-muted",
					)}
				>
					{icon}
				</span>
				<input
					{...registration}
					id={id}
					autoComplete={autoComplete}
					aria-invalid={invalid || undefined}
					type={type}
					placeholder={placeholder}
					className={cn(
						"h-11 w-full rounded-lg border bg-panel-main ps-11 text-sm text-panel-text outline-none transition-colors placeholder:text-panel-text-muted",
						endElement ? "pe-11" : "pe-3",
						invalid
							? "border-panel-danger focus-visible:border-panel-danger focus-visible:ring-1 focus-visible:ring-panel-danger/60"
							: "border-panel-border hover:border-panel-border-strong focus-visible:border-panel-accent focus-visible:ring-1 focus-visible:ring-panel-accent",
					)}
				/>
				{endElement ? (
					<span className="absolute end-1 top-1/2 -translate-y-1/2">
						{endElement}
					</span>
				) : null}
			</div>
			{errorMessage ? (
				<p role="alert" className="text-xs text-panel-danger">
					{errorMessage}
				</p>
			) : null}
		</div>
	);
}

/** Theme switcher for the sign-in screen, on the shadcn dropdown. */
const LoginThemeMenu = () => {
	const { t } = useTranslation();
	const { colorMode, setColorMode } = useColorMode();
	const activeTheme: LoginThemeMode = colorMode === "light" ? "light" : "dark";

	const selectTheme = (theme: LoginThemeMode) => {
		applyLoginThemeMode(theme);
		setColorMode(theme);
	};

	const options: Array<{ key: LoginThemeMode; label: string; icon: ReactNode }> = [
		{ key: "dark", label: t("theme.dark"), icon: <Moon className="size-4" /> },
		{ key: "light", label: t("theme.light"), icon: <Sun className="size-4" /> },
	];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button type="button" aria-label={t("header.theme")} variant="ghost" size="icon">
					{activeTheme === "dark" ? (
						<Moon className="size-4" />
					) : (
						<Sun className="size-4" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="items-end min-w-40">
				{options.map((option) => (
					<DropdownMenuItem key={option.key} onSelect={() => selectTheme(option.key)}>
						{option.icon}
						<span className="flex-1">{option.label}</span>
						{activeTheme === option.key ? (
							<Check className="size-4 text-panel-accent" />
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

export const Login = () => {
	const [error, setError] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [step, setStep] = useState<"credentials" | "otp" | "setup">("credentials");
	const [otp, setOTP] = useState("");
	const [setup, setSetup] = useState<TOTPSetup | null>(null);
	const [challengeLoading, setChallengeLoading] = useState(false);
	const navigate = useNavigate();
	const { t, i18n } = useTranslation();
	const dir = i18n.dir(i18n.language) === "rtl" ? "rtl" : "ltr";

	const {
		register,
		formState: { errors, isSubmitting },
		handleSubmit,
		watch,
	} = useForm<LoginFormValues>({
		resolver: zodResolver(schema),
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
		<div className="flex min-h-[100dvh] w-full items-center justify-center bg-panel-main px-4 py-6 md:px-10 md:py-10">
			<div className="w-full max-w-[400px]">
				<div className="rounded-lg border border-panel-border bg-panel-surface p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)] sm:p-6">
					{/* Brand, language and theme on one line, above the form. */}
					<div className="mb-7 flex items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-3 text-panel-text">
							<span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-panel-border bg-panel-elevated">
								<img
									alt={t("menu")}
									src={logoUrl}
									className="size-6 [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]"
								/>
							</span>
							<span className="truncate text-lg font-extrabold">Rebecca</span>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<Language triggerVariant="ghost" />
							<LoginThemeMenu />
						</div>
					</div>

					<div className="space-y-1 text-center">
						<h1 className="text-lg font-extrabold text-panel-text">{title}</h1>
						<p className="text-sm text-panel-text-muted">{subtitle}</p>
					</div>

					<div className="mt-6">
						{step === "credentials" ? (
							<form onSubmit={handleSubmit(login, handleInvalid)}>
								<div className="space-y-4">
									<LoginField
										id="login-username"
										autoComplete="username"
										dir={dir}
										errorMessage={
											errors.username?.message
												? t(errors.username.message as string)
												: undefined
										}
										icon={<User className="size-4" />}
										label={t("username")}
										placeholder={t("username")}
										registration={register("username")}
									/>
									<LoginField
										id="login-password"
										autoComplete="current-password"
										dir={dir}
										endElement={
											<button
												type="button"
												aria-label={
													showPassword
														? t("admins.hidePassword")
														: t("admins.showPassword")
												}
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => setShowPassword((visible) => !visible)}
												className="inline-flex size-8 items-center justify-center rounded-md text-panel-text-muted transition-colors hover:text-panel-text"
											>
												{showPassword ? (
													<EyeOff className="size-4" />
												) : (
													<Eye className="size-4" />
												)}
											</button>
										}
										errorMessage={
											errors.password?.message
												? t(errors.password.message as string)
												: undefined
										}
										icon={<Lock className="size-4" />}
										label={t("password")}
										placeholder={t("password")}
										registration={register("password")}
										type={showPassword ? "text" : "password"}
									/>

									{error ? (
										<div
											role="alert"
											className="rounded-lg border-s-2 border-panel-danger bg-panel-danger/10 px-3 py-2 text-sm text-panel-danger"
										>
											{error}
										</div>
									) : null}

									<Button type="submit" disabled={!canSubmit} className="mt-1 h-11 w-full rounded-lg text-sm">
										<LogIn className="size-4" />
										{isSubmitting ? t("login.loading") : t("login")}
									</Button>
								</div>
							</form>
						) : (
							<div className="space-y-4">
								{step === "setup" && setup ? (
									<>
										<div className="w-fit rounded-lg bg-white p-3">
											<QRCodeCanvas value={setup.uri} size={180} />
										</div>
										<p className="break-all font-mono text-xs text-panel-text-muted">
											{setup.secret}
										</p>
									</>
								) : null}

								<div className="space-y-2">
									<label
										htmlFor="login-otp"
										className="block text-sm font-bold text-panel-text"
									>
										{t("login.authenticationCode")}
									</label>
									<input
										id="login-otp"
										inputMode="numeric"
										autoComplete="one-time-code"
										maxLength={6}
										value={otp}
										onChange={(event) =>
											setOTP(event.target.value.replace(/\D/g, ""))
										}
										className="h-11 w-full rounded-lg border border-panel-border bg-panel-main text-center text-sm tracking-[0.4em] text-panel-text outline-none transition-colors hover:border-panel-border-strong focus-visible:border-panel-accent focus-visible:ring-1 focus-visible:ring-panel-accent"
									/>
								</div>

								{error ? (
									<div
										role="alert"
										className="rounded-lg border-s-2 border-panel-danger bg-panel-danger/10 px-3 py-2 text-sm text-panel-danger"
									>
										{error}
									</div>
								) : null}

								<Button onClick={step === "otp" ? submitOTP : confirmSetup} disabled={otp.length !== 6} loading={challengeLoading} className="h-11 w-full rounded-lg text-sm">
									{t("continue")}
								</Button>
								<Button onClick={cancelChallenge} variant="ghost" className="w-full rounded-lg">
									{t("back")}
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Login;
