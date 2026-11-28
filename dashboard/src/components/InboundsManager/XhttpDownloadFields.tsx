import { SearchableTagSelect } from "components/common/SearchableTagSelect";
import { Button } from "components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "components/ui/field";
import { FieldHint } from "components/ui/field-hint";
import { Input } from "components/ui/input";
import { Switch } from "components/ui/switch";
import { Textarea } from "components/ui/textarea";
import {
	type Control,
	Controller,
	type UseFormGetValues,
	type UseFormSetValue,
	useWatch,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
	buildInboundPayload,
	type InboundFormValues,
	tlsAlpnOptions,
	tlsFingerprintOptions,
} from "utils/inbounds";
import {
	XHTTP_DOWNLOAD_GROUPS,
	XHTTP_SHARED_KEYS,
	type XhttpFieldSpec,
} from "utils/xhttpDownload";

const GROUP_TITLES: Record<string, string> = {
	xhttp: "XHTTP",
	obfs: "Padding, session, sequence",
	xmux: "XMUX",
	tls: "TLS",
	reality: "REALITY",
	sockopt: "Sockopt",
};

export const XhttpDownloadFields = ({
	control,
	errors,
	getValues,
	setValue,
}: {
	control: Control<InboundFormValues>;
	errors: Record<string, string | undefined>;
	getValues: UseFormGetValues<InboundFormValues>;
	setValue: UseFormSetValue<InboundFormValues>;
}) => {
	const { t } = useTranslation();
	const enabled = useWatch({ control, name: "xhttpDownload.enabled" });
	const security = useWatch({
		control,
		name: "xhttpDownload.settings.security" as "tag",
	});
	const label = (key: string) => t(`inbounds.xhttp.download.${key}`);

	const copyShared = () => {
		const upload =
			buildInboundPayload(getValues()).streamSettings?.xhttpSettings ?? {};
		for (const key of XHTTP_SHARED_KEYS) {
			setValue(
				`xhttpDownload.settings.xhttpSettings.${key}` as "tag",
				upload[key] ?? "",
				{ shouldDirty: true },
			);
		}
	};

	const renderField = (
		spec: XhttpFieldSpec,
		title = spec.path.replace(/^\w+Settings\./, ""),
		error?: string,
	) => {
		const options = spec.path.endsWith(".fingerprint")
			? tlsFingerprintOptions
			: spec.options;
		const list = spec.type === "list";
		return (
			<Field key={spec.path} data-invalid={Boolean(error) || undefined}>
				<FieldLabel>{title}</FieldLabel>
				<Controller
					control={control}
					name={`xhttpDownload.settings.${spec.path}` as "tag"}
					render={({ field }) => {
						const value = field.value as unknown;
						if (spec.type === "bool") {
							return (
								<Switch
									aria-label={title}
									checked={Boolean(value)}
									onCheckedChange={field.onChange}
								/>
							);
						}
						if (options || list) {
							return (
								<SearchableTagSelect
									mode={list ? "multiple" : "single"}
									value={(value ?? (list ? [] : "")) as string | string[]}
									options={
										list
											? tlsAlpnOptions
											: [
													{ value: "", label: t("common.default") },
													...(options ?? []),
												]
									}
									placeholder={title}
									onChange={field.onChange}
								/>
							);
						}
						return (
							<Input
								dir="ltr"
								aria-label={title}
								aria-invalid={Boolean(error)}
								value={String(value ?? "")}
								onChange={field.onChange}
							/>
						);
					}}
				/>
				{error && <FieldError>{error}</FieldError>}
				{spec.path.includes(".") && (
					<FieldDescription>
						{t(`inbounds.xhttp.hint.${spec.path.split(".").pop()}`)}
					</FieldDescription>
				)}
			</Field>
		);
	};

	const groupErrors: Record<string, string | undefined> = {
		"realitySettings.serverName": errors.xhttpDownloadServerName,
		"realitySettings.publicKey": errors.xhttpDownloadPublicKey,
	};

	return (
		<div
			className="flex flex-col gap-3 xray-dialog-section"
			data-form-section="xhttp-download"
			data-form-section-title={label("title")}
		>
			<div className="flex items-center justify-between gap-4 rounded-lg border bg-card/40 px-3 py-2.5">
				<span className="inline-flex items-center gap-1.5 font-semibold">
					{label("title")}
					<FieldHint>{label("help")}</FieldHint>
				</span>
				<Controller
					control={control}
					name="xhttpDownload.enabled"
					render={({ field }) => (
						<Switch
							aria-label={label("title")}
							checked={field.value}
							onCheckedChange={field.onChange}
						/>
					)}
				/>
			</div>
			{errors.xhttpDownload && <FieldError>{errors.xhttpDownload}</FieldError>}
			{enabled && (
				<>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
						{renderField(
							{ path: "address" },
							label("address"),
							errors.xhttpDownloadAddress,
						)}
						{renderField(
							{ path: "port" },
							label("port"),
							errors.xhttpDownloadPort,
						)}
						{renderField(
							{ path: "security", options: ["tls", "reality", "none"] },
							label("security"),
						)}
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={copyShared}
					>
						{label("copyShared")}
					</Button>
					<Field>
						<FieldLabel>{label("headers")}</FieldLabel>
						<Controller
							control={control}
							name="xhttpDownload.headers"
							render={({ field }) => (
								<Textarea
									{...field}
									dir="ltr"
									aria-label={label("headers")}
									placeholder="X-Name: value"
								/>
							)}
						/>
					</Field>
					{Object.entries(XHTTP_DOWNLOAD_GROUPS)
						.filter(
							([group]) =>
								(group !== "tls" && group !== "reality") ||
								group === (security as string),
						)
						.map(([group, specs]) => (
							<div key={group} className="flex flex-col gap-2">
								<p className="text-sm font-semibold">{GROUP_TITLES[group]}</p>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									{specs.map((spec) =>
										renderField(spec, undefined, groupErrors[spec.path]),
									)}
								</div>
							</div>
						))}
				</>
			)}
		</div>
	);
};
