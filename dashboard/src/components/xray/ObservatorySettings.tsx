import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { SegmentedControl } from "components/ui/segmented-control";
import { Switch } from "components/ui/switch";
import {
	MultiValueAutocomplete,
	splitMultiValueText,
} from "../common/MultiValueAutocomplete";

export type ObservatoryConfig = {
	subjectSelector?: string[];
	probeUrl?: string;
	probeURL?: string;
	probeInterval?: string;
	enableConcurrency?: boolean;
};

export type BurstPingConfig = {
	destination?: string;
	connectivity?: string;
	interval?: string;
	sampling?: number;
	timeout?: string;
	httpMethod?: string;
};

export type BurstObservatoryConfig = {
	subjectSelector?: string[];
	pingConfig?: BurstPingConfig;
};

type ObservatorySettingsProps = {
	observatory?: ObservatoryConfig;
	burstObservatory?: BurstObservatoryConfig;
	leastPingTags: string[];
	leastLoadTags: string[];
	outboundOptions: string[];
	onChange: (next: {
		observatory?: ObservatoryConfig;
		burstObservatory?: BurstObservatoryConfig;
	}) => void;
};

const HTTP_METHODS = ["HEAD", "GET"];

export const observatoryProbeUrl = (value?: ObservatoryConfig) =>
	value?.probeUrl ?? value?.probeURL ?? "";

export const ObservatorySettings: FC<ObservatorySettingsProps> = ({
	observatory,
	burstObservatory,
	leastPingTags,
	leastLoadTags,
	outboundOptions,
	onChange,
}) => {
	const { t } = useTranslation();

	if (!observatory && !burstObservatory) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("pages.xray.observatory.empty")}
			</p>
		);
	}

	const pingConfig = burstObservatory?.pingConfig ?? {};
	const usedBy = (tags: string[]) =>
		tags.length ? tags.join(", ") : t("pages.xray.observatory.notUsed");

	return (
		<div className="flex flex-col gap-4">
			{observatory ? (
				<section className="flex flex-col gap-4 rounded-lg border p-4">
					<div className="flex flex-col gap-1">
						<h3 className="text-sm font-medium">Observatory</h3>
						<p className="text-xs text-muted-foreground">
							{t("pages.xray.observatory.observatoryDesc")}
						</p>
						<p className="text-xs text-muted-foreground">
							{t("pages.xray.observatory.usedBy", { tags: usedBy(leastPingTags) })}
						</p>
					</div>
					<Field>
						<FieldLabel>{t("pages.xray.observatory.subjectSelector")}</FieldLabel>
						<MultiValueAutocomplete
							options={outboundOptions}
							value={(observatory.subjectSelector ?? []).join(", ")}
							onChange={(value) =>
								onChange({
									observatory: {
										...observatory,
										subjectSelector: splitMultiValueText(value),
									},
								})
							}
							placeholder={t("pages.xray.observatory.subjectPlaceholder")}
						/>
						<FieldDescription>{t("pages.xray.observatory.subjectDesc")}</FieldDescription>
					</Field>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Field>
							<FieldLabel>{t("pages.xray.observatory.probeUrl")}</FieldLabel>
							<Input
								placeholder="https://www.google.com/generate_204"
								value={observatoryProbeUrl(observatory)}
								onChange={(event) =>
									onChange({
										observatory: {
											...observatory,
											probeUrl: event.target.value,
											probeURL: undefined,
										},
									})
								}
							/>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.observatory.probeInterval")}</FieldLabel>
							<Input
								placeholder="10m"
								value={observatory.probeInterval ?? ""}
								onChange={(event) =>
									onChange({
										observatory: { ...observatory, probeInterval: event.target.value },
									})
								}
							/>
							<FieldDescription>{t("pages.xray.observatory.durationDesc")}</FieldDescription>
						</Field>
					</div>
					<div className="flex items-center justify-between gap-4">
						<div className="flex flex-col gap-0.5">
							<FieldLabel>{t("pages.xray.observatory.enableConcurrency")}</FieldLabel>
							<FieldDescription>{t("pages.xray.observatory.enableConcurrencyDesc")}</FieldDescription>
						</div>
						<Switch
							checked={observatory.enableConcurrency ?? false}
							onCheckedChange={(checked: boolean) =>
								onChange({
									observatory: { ...observatory, enableConcurrency: checked },
								})
							}
						/>
					</div>
				</section>
			) : null}

			{burstObservatory ? (
				<section className="flex flex-col gap-4 rounded-lg border p-4">
					<div className="flex flex-col gap-1">
						<h3 className="text-sm font-medium">Burst Observatory</h3>
						<p className="text-xs text-muted-foreground">
							{t("pages.xray.observatory.burstDesc")}
						</p>
						<p className="text-xs text-muted-foreground">
							{t("pages.xray.observatory.usedBy", { tags: usedBy(leastLoadTags) })}
						</p>
					</div>
					<Field>
						<FieldLabel>{t("pages.xray.observatory.subjectSelector")}</FieldLabel>
						<MultiValueAutocomplete
							options={outboundOptions}
							value={(burstObservatory.subjectSelector ?? []).join(", ")}
							onChange={(value) =>
								onChange({
									burstObservatory: {
										...burstObservatory,
										subjectSelector: splitMultiValueText(value),
									},
								})
							}
							placeholder={t("pages.xray.observatory.subjectPlaceholder")}
						/>
						<FieldDescription>{t("pages.xray.observatory.subjectDesc")}</FieldDescription>
					</Field>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Field>
							<FieldLabel>{t("pages.xray.observatory.destination")}</FieldLabel>
							<Input
								placeholder="https://connectivitycheck.gstatic.com/generate_204"
								value={pingConfig.destination ?? ""}
								onChange={(event) =>
									onChange({
										burstObservatory: {
											...burstObservatory,
											pingConfig: { ...pingConfig, destination: event.target.value },
										},
									})
								}
							/>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.observatory.connectivity")}</FieldLabel>
							<Input
								value={pingConfig.connectivity ?? ""}
								onChange={(event) =>
									onChange({
										burstObservatory: {
											...burstObservatory,
											pingConfig: { ...pingConfig, connectivity: event.target.value },
										},
									})
								}
							/>
							<FieldDescription>{t("pages.xray.observatory.connectivityDesc")}</FieldDescription>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.observatory.interval")}</FieldLabel>
							<Input
								placeholder="1m"
								value={pingConfig.interval ?? ""}
								onChange={(event) =>
									onChange({
										burstObservatory: {
											...burstObservatory,
											pingConfig: { ...pingConfig, interval: event.target.value },
										},
									})
								}
							/>
							<FieldDescription>{t("pages.xray.observatory.burstIntervalDesc")}</FieldDescription>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.observatory.sampling")}</FieldLabel>
							<Input
								type="number"
								min={1}
								step={1}
								value={pingConfig.sampling ?? ""}
								onChange={(event) =>
									onChange({
										burstObservatory: {
											...burstObservatory,
											pingConfig: {
												...pingConfig,
												sampling:
													event.target.value === "" ? undefined : Number(event.target.value),
											},
										},
									})
								}
							/>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.observatory.timeout")}</FieldLabel>
							<Input
								placeholder="5s"
								value={pingConfig.timeout ?? ""}
								onChange={(event) =>
									onChange({
										burstObservatory: {
											...burstObservatory,
											pingConfig: { ...pingConfig, timeout: event.target.value },
										},
									})
								}
							/>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.observatory.httpMethod")}</FieldLabel>
							<SegmentedControl<string>
								label={t("pages.xray.observatory.httpMethod")}
								value={pingConfig.httpMethod ?? "HEAD"}
								options={HTTP_METHODS.map((method) => ({ value: method, label: method }))}
								onChange={(next) =>
									onChange({
										burstObservatory: {
											...burstObservatory,
											pingConfig: { ...pingConfig, httpMethod: next },
										},
									})
								}
							/>
						</Field>
					</div>
				</section>
			) : null}
		</div>
	);
};
