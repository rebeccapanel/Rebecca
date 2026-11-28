import { SearchableTagSelect } from "components/common/SearchableTagSelect";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "components/ui/field";
import { Input } from "components/ui/input";
import { type FC, useState } from "react";
import {
	type Control,
	type UseFormGetValues,
	type UseFormSetValue,
	useWatch,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
	formatVlessEnc,
	isVlessPadding,
	isVlessServerTicket,
	parseVlessEnc,
	VLESS_ENC_MODES,
	type VlessEnc,
	vlessAuthLabelForMode,
} from "utils/generators";
import type { InboundFormValues } from "utils/inbounds";

const dirty = { shouldDirty: true, shouldValidate: true };

type Target = "vlessDecryption" | "vlessEncryption";

const CheckedInput: FC<{
	name: string;
	value: string;
	placeholder: string;
	valid: (value: string) => boolean;
	onChange: (value: string) => void;
}> = ({ name, value, placeholder, valid, onChange }) => {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<string | null>(null);
	const invalid = draft !== null && !valid(draft.trim());
	return (
		<Field data-invalid={invalid || undefined}>
			<FieldLabel>{t(`vlessEnc.${name}`)}</FieldLabel>
			<Input
				dir="ltr"
				aria-label={t(`vlessEnc.${name}`)}
				aria-invalid={invalid}
				placeholder={placeholder}
				value={draft ?? value}
				onChange={(event) => {
					setDraft(event.target.value);
					const next = event.target.value.trim();
					if (valid(next)) onChange(next);
				}}
				onBlur={() => {
					if (!invalid) setDraft(null);
				}}
			/>
			{invalid && <FieldError>{t("xrayFields.invalid")}</FieldError>}
			<FieldDescription>{t(`vlessEnc.hint.${name}`)}</FieldDescription>
		</Field>
	);
};

export const VlessEncryptionOptions: FC<{
	control: Control<InboundFormValues>;
	setValue: UseFormSetValue<InboundFormValues>;
	getValues: UseFormGetValues<InboundFormValues>;
}> = ({ control, setValue, getValues }) => {
	const { t } = useTranslation();
	const decryption = useWatch({ control, name: "vlessDecryption" }) || "";
	const encryption = useWatch({ control, name: "vlessEncryption" }) || "";
	const server = parseVlessEnc(decryption);
	const client = parseVlessEnc(encryption);
	if (!server) return null;

	const patch = (target: Target, change: Partial<VlessEnc>) => {
		const parsed = parseVlessEnc(getValues(target) || "");
		if (parsed)
			setValue(target, formatVlessEnc({ ...parsed, ...change }), dirty);
	};

	return (
		<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
			<Field className="md:col-span-2">
				<FieldLabel>{t("vlessEnc.mode")}</FieldLabel>
				<SearchableTagSelect
					value={server.mode}
					options={VLESS_ENC_MODES}
					placeholder={t("vlessEnc.mode")}
					onChange={(next) => {
						const mode = String(next);
						patch("vlessDecryption", { mode });
						patch("vlessEncryption", { mode });
						setValue(
							"vlessSelectedAuth",
							vlessAuthLabelForMode(getValues("vlessSelectedAuth"), mode),
							dirty,
						);
					}}
				/>
				<FieldDescription>{t("vlessEnc.hint.mode")}</FieldDescription>
			</Field>
			<CheckedInput
				name="serverTicket"
				value={server.ticket}
				placeholder="600s / 100-500s"
				valid={isVlessServerTicket}
				onChange={(ticket) => patch("vlessDecryption", { ticket })}
			/>
			{client && (
				<Field>
					<FieldLabel>{t("vlessEnc.clientTicket")}</FieldLabel>
					<SearchableTagSelect
						value={client.ticket}
						options={["0rtt", "1rtt"]}
						placeholder={t("vlessEnc.clientTicket")}
						onChange={(next) =>
							patch("vlessEncryption", { ticket: String(next) })
						}
					/>
					<FieldDescription>{t("vlessEnc.hint.clientTicket")}</FieldDescription>
				</Field>
			)}
			<CheckedInput
				name="serverPadding"
				value={server.padding}
				placeholder="100-111-1111.75-0-111.50-0-3333"
				valid={isVlessPadding}
				onChange={(padding) => patch("vlessDecryption", { padding })}
			/>
			{client && (
				<CheckedInput
					name="clientPadding"
					value={client.padding}
					placeholder="100-111-1111.75-0-111.50-0-3333"
					valid={isVlessPadding}
					onChange={(padding) => patch("vlessEncryption", { padding })}
				/>
			)}
		</div>
	);
};
