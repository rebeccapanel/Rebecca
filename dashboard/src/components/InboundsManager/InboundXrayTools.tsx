import { FinalMaskEditor } from "components/FinalMaskEditor";
import { Button } from "components/ui/button";
import { Field, FieldError } from "components/ui/field";
import { toast } from "components/ui/sonner";
import { type FC, useState } from "react";
import {
	type Control,
	type UseFormGetValues,
	type UseFormSetValue,
	useWatch,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { fetchCertificateHash } from "service/xray";
import { sanitizeFinalMask } from "utils/finalmask";
import {
	type InboundFormValues,
	inboundFinalMaskCapabilities,
} from "utils/inbounds";
import { randomSpiderX } from "utils/xrayRawFields";

const dirty = { shouldDirty: true, shouldValidate: true };

type Tools = {
	setValue: UseFormSetValue<InboundFormValues>;
	getValues: UseFormGetValues<InboundFormValues>;
};

export const CertificateHashTools: FC<Tools> = ({ setValue, getValues }) => {
	const { t } = useTranslation();
	const [busy, setBusy] = useState(false);

	const fill = async (source: "certificate" | "remote") => {
		const values = getValues();
		const certificate = values.tlsCertificates?.[0];
		const sni = (values.tlsServerName ?? "").trim();
		const request =
			source === "remote"
				? { server_name: sni }
				: certificate?.useFile
					? { certificate_file: certificate.certFile }
					: { certificate: certificate?.cert };
		setBusy(true);
		try {
			const { sha256 } = await fetchCertificateHash(request);
			setValue("tlsPinnedPeerCertSha256", sha256, dirty);
		} catch (error: any) {
			toast.error(
				error?.data?.detail || error?.message || t("xrayTools.hashFailed"),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-wrap gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={busy}
				onClick={() => fill("certificate")}
			>
				{t("xrayTools.hashFromCertificate")}
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={busy}
				onClick={() => fill("remote")}
			>
				{t("xrayTools.hashFromServer")}
			</Button>
		</div>
	);
};

export const RandomSpiderXButton: FC<Pick<Tools, "setValue">> = ({
	setValue,
}) => {
	const { t } = useTranslation();
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => setValue("realitySpiderX", randomSpiderX(), dirty)}
		>
			{t("xrayTools.randomSpiderX")}
		</Button>
	);
};

export const RealClientIpPresets: FC<Pick<Tools, "setValue">> = ({
	setValue,
}) => {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col gap-2 py-2">
			<p className="text-sm font-medium">{t("xrayTools.realIp")}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						setValue("sockoptEnabled", true, dirty);
						setValue("sockopt.trustedXForwardedFor", "CF-Connecting-IP", dirty);
						setValue("sockopt.acceptProxyProtocol", false, dirty);
					}}
				>
					Cloudflare
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						setValue("sockoptEnabled", true, dirty);
						setValue("sockopt.acceptProxyProtocol", true, dirty);
						setValue("sockopt.trustedXForwardedFor", "", dirty);
					}}
				>
					PROXY protocol
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				{t("xrayTools.realIpHint")}
			</p>
		</div>
	);
};

export const InboundFinalMask: FC<
	Pick<Tools, "setValue"> & {
		control: Control<InboundFormValues>;
		error?: string;
	}
> = ({ control, setValue, error }) => {
	const { t } = useTranslation();
	const values = useWatch({ control }) as InboundFormValues;
	const capabilities = inboundFinalMaskCapabilities(values);
	if (values.protocol === "hysteria" || !capabilities.supported) return null;
	return (
		<Field
			className="col-span-full flex flex-col xray-dialog-section"
			data-form-section="finalmask"
			data-form-section-title={t("hostsDialog.finalMask")}
		>
			<p className="text-sm font-semibold">{t("hostsDialog.finalMask")}</p>
			<FinalMaskEditor
				value={sanitizeFinalMask(values.finalmaskRaw, capabilities)}
				onChange={(next) => setValue("finalmaskRaw", next ?? {}, dirty)}
				capabilities={capabilities}
			/>
			{error && <FieldError>{error}</FieldError>}
		</Field>
	);
};
