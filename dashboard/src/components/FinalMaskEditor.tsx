import { toneClass } from "lib/tone";
import { Field, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Switch } from "components/ui/switch";
import { Button } from "components/ui/button";
import { Textarea } from "components/ui/textarea";
import { Collapsible, CollapsibleContent } from "components/ui/collapsible";
import { Badge } from "components/ui/badge";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { cn } from "lib/cn";
import type { FC, ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type FinalMaskCapabilities,
	type FinalMaskLayer,
	type FinalMaskObject,
	type FinalMaskSettings,
	REALM_TLS_FINGERPRINTS,
} from "utils/finalmask";
import { SearchableTagSelect } from "./common/SearchableTagSelect";

type FinalMaskEditorProps = {
	value: FinalMaskObject | null;
	onChange: (value: FinalMaskObject | null) => void;
	capabilities: FinalMaskCapabilities;
};

type Direction = "tcp" | "udp";

const asRecord = (value: unknown): FinalMaskSettings =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as FinalMaskSettings)
		: {};

const asArray = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];

const textValue = (value: unknown) =>
	value === undefined || value === null ? "" : String(value);

const stringArray = (value: unknown) =>
	asArray(value).map((item) => String(item));

const optionalText = (value: string): string | undefined =>
	value === "" ? undefined : value;

const optionalNumber = (value: string): number | undefined => {
	if (value === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const setKey = (
	object: FinalMaskSettings,
	key: string,
	value: unknown,
): FinalMaskSettings => {
	const next = { ...object };
	if (value === undefined) delete next[key];
	else next[key] = value;
	return next;
};

const typeLabel = (type: string) =>
	({
		"header-custom": "Custom header",
		fragment: "Fragment",
		sudoku: "Sudoku",
		"mkcp-legacy": "mKCP legacy",
		noise: "Noise",
		salamander: "Salamander / Gecko",
		xdns: "XDNS",
		xicmp: "XICMP",
		realm: "Realm",
	})[type] ?? type;

const typeDescription = (type: string) =>
	({
		"header-custom": "Build custom packets for the start of a connection.",
		fragment: "Split TCP packets using readable length and delay patterns.",
		sudoku: "Encode packet shapes with a password and optional padding.",
		"mkcp-legacy": "Use a legacy mKCP-compatible header.",
		noise: "Add configurable noise packets and delays.",
		salamander: "Apply Salamander or Gecko obfuscation.",
		xdns: "Carry traffic through DNS domains and resolvers.",
		xicmp: "Carry UDP traffic through ICMP endpoints.",
		realm: "Route UDP traffic through a Realm endpoint.",
	})[type] ?? "Configure this mask layer.";

const TextField: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: string | undefined) => void;
	placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
	<Field>
		<FieldLabel className="text-[0.875rem]">{label}</FieldLabel>
		<Input value={textValue(value)} onChange={(event) => onChange(optionalText(event.target.value))} />
	</Field>
);

const NumberField: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: number | undefined) => void;
	min?: number;
	max?: number;
	placeholder?: string;
}> = ({ label, value, onChange, min = 0, max, placeholder }) => (
	<Field>
		<FieldLabel className="text-[0.875rem]">{label}</FieldLabel>
		<Input type="number" min={min} max={max} value={textValue(value)} onChange={(event) => onChange(optionalNumber(event.target.value))} />
	</Field>
);

const SelectField: FC<{
	label: ReactNode;
	value: unknown;
	options: Array<string | { label: string; value: string }>;
	onChange: (value: string | undefined) => void;
	placeholder?: string;
}> = ({ label, value, options, onChange, placeholder }) => (
	<Field>
		<FieldLabel className="text-[0.875rem]">{label}</FieldLabel>
		<SearchableTagSelect
			value={textValue(value)}
			options={options}
			placeholder={placeholder ?? String(label)}
			onChange={(next) => onChange(optionalText(String(next)))}
		/>
	</Field>
);

const BooleanField: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: boolean) => void;
}> = ({ label, value, onChange }) => (
	<Field className="flex items-center gap-2 w-auto">
		<FieldLabel className="text-[0.875rem] mb-0 cursor-pointer">
			{label}
		</FieldLabel>
		<Switch aria-label={typeof label === "string" ? label : undefined} checked={Boolean(value)} onCheckedChange={(checked: boolean) => onChange(checked)} />
	</Field>
);

const OrderButtons: FC<{
	index: number;
	length: number;
	onMove: (from: number, to: number) => void;
	onRemove: () => void;
	disableUp?: boolean;
	disableDown?: boolean;
}> = ({
	index,
	length,
	onMove,
	onRemove,
	disableUp = false,
	disableDown = false,
}) => (
	<div className="flex flex-row items-center gap-1">
		<Button aria-label="Move up" disabled={index === 0 || disableUp} onClick={() => onMove(index, index - 1)} variant="ghost" size="xs" className="size-7 p-0">{<ArrowUp className="w-[14px]" />}</Button>
		<Button aria-label="Move down" disabled={index === length - 1 || disableDown} onClick={() => onMove(index, index + 1)} variant="ghost" size="xs" className="size-7 p-0">{<ArrowDown className="w-[14px]" />}</Button>
		<Button aria-label="Remove" onClick={onRemove} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10 size-7 p-0">{<Trash2 className="w-[14px]" />}</Button>
	</div>
);

const moveItem = <T,>(items: T[], from: number, to: number) => {
	if (to < 0 || to >= items.length) return items;
	const next = [...items];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
};

const UDP_FIRST_TYPES = new Set(["realm", "xicmp"]);

const normalizeUdpLayers = (layers: FinalMaskLayer[]) => {
	const first = layers.find((layer) => UDP_FIRST_TYPES.has(layer.type));
	const sudoku = layers.find((layer) => layer.type === "sudoku");
	return [
		...(first ? [first] : []),
		...layers.filter(
			(layer) => !UDP_FIRST_TYPES.has(layer.type) && layer.type !== "sudoku",
		),
		...(sudoku ? [sudoku] : []),
	];
};

export const createFinalMaskLayer = (
	direction: Direction,
	type: string,
): FinalMaskLayer => {
	if (type === "fragment") {
		return {
			type,
			settings: {
				packets: "tlshello",
				lengths: ["10-100"],
				delays: ["100-200"],
			},
		};
	}
	if (type === "header-custom") {
		return {
			type,
			settings:
				direction === "tcp"
					? { clients: [[{}]], servers: [[{}]] }
					: { client: [{}], server: [{}] },
		};
	}
	if (type === "noise") {
		return {
			type,
			settings: {
				noise: [{ rand: "10-20", randRange: "0-255", delay: "100-200" }],
			},
		};
	}
	return { type, settings: {} };
};

const StringArrayField: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: string[] | undefined) => void;
	placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => {
	return (
		<Field>
			<FieldLabel className="text-[0.875rem]">{label}</FieldLabel>
			<Textarea rows={3} value={stringArray(value).join("\n")} onChange={(event) =>
					onChange(
						event.target.value === ""
							? undefined
							: event.target.value.split(/\r?\n/),
					)
				} />
			<p className="mt-1 text-[0.75rem] text-gray-500">
				One value per line.
			</p>
		</Field>
	);
};

const NumberArrayField: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: number[] | undefined) => void;
}> = ({ label, value, onChange }) => {
	const { t } = useTranslation();
	const items = asArray(value).map((item) => Number(item) || 0);
	const update = (next: number[]) => onChange(next.length ? next : undefined);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[0.875rem] font-medium">
					{label}
				</p>
				<Button onClick={() => update([...items, 0])} variant="outline" size="xs">{<Plus className="w-[13px]" />}
					{t("add")}
				</Button>
			</div>
			{items.map((item, index) => (
				<div key={`${index}-${items.length}`} className="flex flex-row gap-2 items-start">
					<Input type="number" min={0} max={255} value={item} onChange={(event) => {
							const next = [...items];
							next[index] = Math.max(
								0,
								Math.min(255, Number(event.target.value) || 0),
							);
							update(next);
						}} />
					<OrderButtons
						index={index}
						length={items.length}
						onMove={(from, to) => update(moveItem(items, from, to))}
						onRemove={() => update(items.filter((_, i) => i !== index))}
					/>
				</div>
			))}
		</div>
	);
};

const PemLinesField: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: string[] | undefined) => void;
	placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
	<Field>
		<FieldLabel className="text-[0.875rem]">{label}</FieldLabel>
		<Textarea value={stringArray(value).join("\n")} onChange={(event) =>
				onChange(
					event.target.value === ""
						? undefined
						: event.target.value.split(/\r?\n/),
				)
			} className="font-mono" />
	</Field>
);

type PacketEditorProps = {
	value: unknown;
	onChange: (value: FinalMaskSettings) => void;
	delay?: "number" | "range";
	rand?: "number" | "range";
};

const PacketEditor: FC<PacketEditorProps> = ({
	value,
	onChange,
	delay,
	rand = "number",
}) => {
	const item = asRecord(value);
	const source = item.rand !== undefined ? "random" : "packet";
	const packetType = textValue(item.type) || "array";
	const update = (key: string, nextValue: unknown) => {
		const next = setKey(item, key, nextValue);
		if (source === "random") {
			delete next.packet;
			delete next.type;
		} else {
			delete next.rand;
			delete next.randRange;
		}
		onChange(next);
	};
	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<SelectField
					label="Content source"
					value={source}
					options={[
						{ value: "packet", label: "Fixed packet" },
						{ value: "random", label: "Random bytes" },
					]}
					onChange={(nextSource) => {
						const next = { ...item };
						if (nextSource === "random") {
							delete next.packet;
							delete next.type;
							next.rand = rand === "range" ? "1-8192" : 1;
						} else {
							delete next.rand;
							delete next.randRange;
							next.type = "array";
							next.packet = [];
						}
						onChange(next);
					}}
				/>
				{source === "random" && rand === "number" && (
					<NumberField
						label="Random length"
						value={item.rand}
						onChange={(next) => update("rand", next)}
					/>
				)}
				{source === "random" && rand === "range" && (
					<TextField
						label="Random length range"
						value={item.rand}
						placeholder="1-8192"
						onChange={(next) => update("rand", next)}
					/>
				)}
				{source === "random" && (
					<TextField
						label="Random byte range"
						value={item.randRange}
						placeholder="0-255"
						onChange={(next) => update("randRange", next)}
					/>
				)}
				{source === "packet" && (
					<SelectField
						label="Packet type"
						value={packetType}
						options={["array", "str", "hex", "base64"]}
						onChange={(nextType) => {
							const next: FinalMaskSettings = {
								...item,
								type: nextType ?? "array",
							};
							if (nextType === "array" && !Array.isArray(next.packet)) {
								next.packet = [];
							}
							if (nextType !== "array" && Array.isArray(next.packet)) {
								next.packet = "";
							}
							onChange(next);
						}}
					/>
				)}
				{delay === "number" && (
					<NumberField
						label="Delay (ms)"
						value={item.delay}
						onChange={(next) => update("delay", next)}
					/>
				)}
				{delay === "range" && (
					<TextField
						label="Delay range (ms)"
						value={item.delay}
						placeholder="10-20"
						onChange={(next) => update("delay", next)}
					/>
				)}
			</div>
			{source === "packet" && packetType === "array" && (
				<NumberArrayField
					label="Packet bytes"
					value={item.packet}
					onChange={(next) => update("packet", next)}
				/>
			)}
			{source === "packet" && packetType !== "array" && (
				<Field>
					<FieldLabel className="text-[0.875rem]">Packet</FieldLabel>
					<Textarea value={textValue(item.packet)} onChange={(event) =>
							update("packet", optionalText(event.target.value))
						} className={cn(packetType === "str" ? "" : "font-mono")} />
				</Field>
			)}
		</div>
	);
};

const PacketListEditor: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: FinalMaskSettings[] | undefined) => void;
	delay?: "number" | "range";
	rand?: "number" | "range";
}> = ({ label, value, onChange, delay, rand }) => {
	const { t } = useTranslation();
	const items = asArray(value).map(asRecord);
	const update = (next: FinalMaskSettings[]) =>
		onChange(next.length ? next : undefined);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[0.875rem] font-semibold">
					{label}
				</p>
				<Button onClick={() => update([...items, {}])} variant="outline" size="xs">{<Plus className="w-[13px]" />}
					{t("add")}
				</Button>
			</div>
			{items.map((item, index) => (
				<div key={`${index}-${items.length}`} className="flex flex-col gap-3 border rounded-md p-3">
					<div className="flex items-center justify-between">
						<p className="text-[0.75rem] text-gray-500">
							#{index + 1}
						</p>
						<OrderButtons
							index={index}
							length={items.length}
							onMove={(from, to) => update(moveItem(items, from, to))}
							onRemove={() => update(items.filter((_, i) => i !== index))}
						/>
					</div>
					<PacketEditor
						value={item}
						delay={delay}
						rand={rand}
						onChange={(nextItem) => {
							const next = [...items];
							next[index] = nextItem;
							update(next);
						}}
					/>
				</div>
			))}
		</div>
	);
};

const TcpHeaderVariants: FC<{
	label: ReactNode;
	value: unknown;
	onChange: (value: FinalMaskSettings[][] | undefined) => void;
}> = ({ label, value, onChange }) => {
	const { t } = useTranslation();
	const variants = asArray(value).map((variant) =>
		asArray(variant).map(asRecord),
	);
	const update = (next: FinalMaskSettings[][]) =>
		onChange(next.length ? next : undefined);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[0.875rem] font-semibold">
					{label}
				</p>
				<Button onClick={() => update([...variants, [{}]])} variant="outline" size="xs">{<Plus className="w-[13px]" />}
					{t("add")}
				</Button>
			</div>
			{variants.map((variant, index) => (
				<div key={`${index}-${variants.length}`} className="flex flex-col gap-3 border rounded-md p-3">
					<div className="flex items-center justify-between">
						<p className="text-[0.75rem] text-gray-500">
							Variant #{index + 1}
						</p>
						<OrderButtons
							index={index}
							length={variants.length}
							onMove={(from, to) => update(moveItem(variants, from, to))}
							onRemove={() => update(variants.filter((_, i) => i !== index))}
						/>
					</div>
					<PacketListEditor
						label="Packet chunks"
						value={variant}
						delay="number"
						onChange={(nextVariant) => {
							const next = [...variants];
							next[index] = nextVariant ?? [];
							update(next);
						}}
					/>
				</div>
			))}
		</div>
	);
};

const HeaderCustomSettings: FC<{
	direction: Direction;
	settings: FinalMaskSettings;
	onChange: (value: FinalMaskSettings) => void;
}> = ({ direction, settings, onChange }) => {
	const update = (key: string, next: unknown) =>
		onChange(setKey(settings, key, next));
	if (direction === "tcp") {
		return (
			<div className="flex flex-col gap-4">
				<TcpHeaderVariants
					label="Client variants"
					value={settings.clients}
					onChange={(next) => update("clients", next)}
				/>
				<TcpHeaderVariants
					label="Server variants"
					value={settings.servers}
					onChange={(next) => update("servers", next)}
				/>
				<TcpHeaderVariants
					label="Error variants"
					value={settings.errors}
					onChange={(next) => update("errors", next)}
				/>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-4">
			<SelectField
				label="Packet mode"
				value={settings.mode}
				options={[
					{ value: "", label: "Core default" },
					{ value: "prefix", label: "Prefix" },
					{ value: "standalone", label: "Standalone" },
				]}
				onChange={(next) => update("mode", next)}
			/>
			<PacketListEditor
				label="Client packets"
				value={settings.client}
				onChange={(next) => update("client", next)}
			/>
			<PacketListEditor
				label="Server packets"
				value={settings.server}
				onChange={(next) => update("server", next)}
			/>
		</div>
	);
};

const SudokuSettings: FC<{
	settings: FinalMaskSettings;
	onChange: (value: FinalMaskSettings) => void;
}> = ({ settings, onChange }) => {
	const update = (key: string, next: unknown) =>
		onChange(setKey(settings, key, next));
	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<TextField
					label="Password"
					value={settings.password}
					onChange={(next) => update("password", next)}
				/>
				<SelectField
					label="ASCII mode"
					value={settings.ascii}
					options={[
						{ value: "", label: "Default" },
						"entropy",
						"prefer_entropy",
						"ascii",
						"prefer_ascii",
					]}
					onChange={(next) => update("ascii", next)}
				/>
				<TextField
					label="Custom table"
					value={settings.customTable}
					onChange={(next) => update("customTable", next)}
				/>
				<NumberField
					label="Minimum padding"
					value={settings.paddingMin}
					onChange={(next) => update("paddingMin", next)}
				/>
				<NumberField
					label="Maximum padding"
					value={settings.paddingMax}
					onChange={(next) => update("paddingMax", next)}
				/>
			</div>
			<StringArrayField
				label="Custom tables"
				value={settings.customTables}
				onChange={(next) => update("customTables", next)}
			/>
		</div>
	);
};

const FragmentSettings: FC<{
	settings: FinalMaskSettings;
	onChange: (value: FinalMaskSettings) => void;
}> = ({ settings, onChange }) => {
	const update = (key: string, next: unknown) =>
		onChange(setKey(settings, key, next));
	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<TextField
					label="Packets"
					value={settings.packets}
					placeholder="tlshello or 1-3"
					onChange={(next) => update("packets", next)}
				/>
				<TextField
					label="Maximum split count"
					value={settings.maxSplit}
					placeholder="3-6"
					onChange={(next) => update("maxSplit", next)}
				/>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<StringArrayField
					label="Fragment lengths (bytes)"
					value={settings.lengths}
					placeholder="3-5"
					onChange={(next) => update("lengths", next)}
				/>
				<StringArrayField
					label="Fragment delays (ms)"
					value={settings.delays}
					placeholder="10-20"
					onChange={(next) => update("delays", next)}
				/>
			</div>
		</div>
	);
};

const CertificateList: FC<{
	value: unknown;
	onChange: (value: FinalMaskSettings[] | undefined) => void;
}> = ({ value, onChange }) => {
	const { t } = useTranslation();
	const certificates = asArray(value).map(asRecord);
	const update = (next: FinalMaskSettings[]) =>
		onChange(next.length ? next : undefined);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<p className="text-[0.875rem] font-semibold">
					Certificates
				</p>
				<Button onClick={() => update([...certificates, {}])} variant="outline" size="xs">{<Plus className="w-[13px]" />}
					{t("add")}
				</Button>
			</div>
			{certificates.map((certificate, index) => {
				const setCertificate = (key: string, nextValue: unknown) => {
					const next = [...certificates];
					next[index] = setKey(certificate, key, nextValue);
					update(next);
				};
				return (
					<div key={`${index}-${certificates.length}`} className="flex flex-col gap-3 border rounded-md p-3">
						<div className="flex items-center justify-between">
							<p className="text-[0.75rem] text-gray-500">
								Certificate #{index + 1}
							</p>
							<OrderButtons
								index={index}
								length={certificates.length}
								onMove={(from, to) => update(moveItem(certificates, from, to))}
								onRemove={() =>
									update(certificates.filter((_, i) => i !== index))
								}
							/>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
							<NumberField
								label="OCSP stapling interval (s)"
								value={certificate.ocspStapling}
								onChange={(next) => setCertificate("ocspStapling", next)}
							/>
							<SelectField
								label="Usage"
								value={certificate.usage}
								options={["encipherment", "verify", "issue"]}
								onChange={(next) => setCertificate("usage", next)}
							/>
							<TextField
								label="Certificate file"
								value={certificate.certificateFile}
								placeholder="/path/to/certificate.crt"
								onChange={(next) => setCertificate("certificateFile", next)}
							/>
							<TextField
								label="Key file"
								value={certificate.keyFile}
								placeholder="/path/to/key.key"
								onChange={(next) => setCertificate("keyFile", next)}
							/>
						</div>
						<div className="flex flex-row items-center gap-6 flex-wrap">
							<BooleanField
								label="One-time loading"
								value={certificate.oneTimeLoading}
								onChange={(next) => setCertificate("oneTimeLoading", next)}
							/>
							<BooleanField
								label="Build certificate chain"
								value={certificate.buildChain}
								onChange={(next) => setCertificate("buildChain", next)}
							/>
						</div>
						<PemLinesField
							label="Certificate content"
							value={certificate.certificate}
							placeholder="-----BEGIN CERTIFICATE-----"
							onChange={(next) => setCertificate("certificate", next)}
						/>
						<PemLinesField
							label="Private key content"
							value={certificate.key}
							placeholder="-----BEGIN PRIVATE KEY-----"
							onChange={(next) => setCertificate("key", next)}
						/>
					</div>
				);
			})}
		</div>
	);
};

const RealmTlsSettings: FC<{
	value: unknown;
	onChange: (value: FinalMaskSettings | undefined) => void;
}> = ({ value, onChange }) => {
	const enabled =
		typeof value === "object" && value !== null && !Array.isArray(value);
	const settings = asRecord(value);
	const compatibleSettings = { ...settings };
	delete compatibleSettings.allowInsecure;
	const update = (key: string, next: unknown) =>
		onChange(setKey(compatibleSettings, key, next));
	return (
		<div className="flex flex-col gap-3">
			<BooleanField
				label="TLS configuration"
				value={enabled}
				onChange={(next) => onChange(next ? compatibleSettings : undefined)}
			/>
			<Collapsible open={enabled}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-3 pt-1">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<TextField
							label="Server name"
							value={settings.serverName}
							onChange={(next) => update("serverName", next)}
						/>
						<TextField
							label="Verify peer certificate by name"
							value={settings.verifyPeerCertByName}
							onChange={(next) => update("verifyPeerCertByName", next)}
						/>
						<SelectField
							label="Minimum TLS version"
							value={settings.minVersion}
							options={[
								{ value: "", label: "Automatic" },
								"1.0",
								"1.1",
								"1.2",
								"1.3",
							]}
							onChange={(next) => update("minVersion", next)}
						/>
						<SelectField
							label="Maximum TLS version"
							value={settings.maxVersion}
							options={[
								{ value: "", label: "Automatic" },
								"1.0",
								"1.1",
								"1.2",
								"1.3",
							]}
							onChange={(next) => update("maxVersion", next)}
						/>
						<TextField
							label="Cipher suites"
							value={settings.cipherSuites}
							placeholder="TLS_AES_128_GCM_SHA256:..."
							onChange={(next) => update("cipherSuites", next)}
						/>
						<SelectField
							label="Fingerprint"
							value={textValue(settings.fingerprint).toLowerCase()}
							options={[
								{ value: "", label: "Automatic (Chrome)" },
								...REALM_TLS_FINGERPRINTS,
							]}
							onChange={(next) => update("fingerprint", next)}
						/>
						<TextField
							label="Pinned peer certificate SHA-256"
							value={settings.pinnedPeerCertSha256}
							onChange={(next) => update("pinnedPeerCertSha256", next)}
						/>
						<TextField
							label="Master key log"
							value={settings.masterKeyLog}
							onChange={(next) => update("masterKeyLog", next)}
						/>
						<TextField
							label="ECH server keys"
							value={settings.echServerKeys}
							onChange={(next) => update("echServerKeys", next)}
						/>
						<TextField
							label="ECH config list"
							value={settings.echConfigList}
							onChange={(next) => update("echConfigList", next)}
						/>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<StringArrayField
							label="ALPN"
							value={settings.alpn}
							placeholder="h2"
							onChange={(next) => update("alpn", next)}
						/>
						<StringArrayField
							label="Curve preferences"
							value={settings.curvePreferences}
							placeholder="X25519"
							onChange={(next) => update("curvePreferences", next)}
						/>
					</div>
					<div className="flex flex-row items-center gap-6 flex-wrap">
						<BooleanField
							label="Reject unknown SNI"
							value={settings.rejectUnknownSni}
							onChange={(next) => update("rejectUnknownSni", next)}
						/>
						<BooleanField
							label="Disable system roots"
							value={settings.disableSystemRoot}
							onChange={(next) => update("disableSystemRoot", next)}
						/>
						<BooleanField
							label="Enable session resumption"
							value={settings.enableSessionResumption}
							onChange={(next) => update("enableSessionResumption", next)}
						/>
					</div>
					<CertificateList
						value={settings.certificates}
						onChange={(next) => update("certificates", next)}
					/>
				</div>
			</CollapsibleContent></Collapsible>
		</div>
	);
};

const UdpSettings: FC<{
	type: string;
	settings: FinalMaskSettings;
	onChange: (value: FinalMaskSettings) => void;
	allowGecko: boolean;
}> = ({ type, settings, onChange, allowGecko }) => {
	const update = (key: string, next: unknown) =>
		onChange(setKey(settings, key, next));
	switch (type) {
		case "header-custom":
			return (
				<HeaderCustomSettings settings={settings} onChange={onChange} direction="udp" />
			);
		case "mkcp-legacy":
			return (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<SelectField
						label="Header"
						value={settings.header}
						options={[
							{ value: "", label: "AES-128-GCM / XOR" },
							"dns",
							"dtls",
							"srtp",
							"utp",
							"wechat",
							"wireguard",
						]}
						onChange={(next) => update("header", next ?? "")}
					/>
					<TextField
						label="Password / domain"
						value={settings.value}
						onChange={(next) => update("value", next)}
					/>
				</div>
			);
		case "noise":
			return (
				<div className="flex flex-col gap-3">
					<TextField
						label="Reset interval (s)"
						value={settings.reset}
						placeholder="30-60"
						onChange={(next) => update("reset", next)}
					/>
					<PacketListEditor
						label="Noise packets"
						value={settings.noise}
						rand="range"
						delay="range"
						onChange={(next) => update("noise", next)}
					/>
				</div>
			);
		case "salamander":
			return (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<TextField
						label="Password"
						value={settings.password}
						onChange={(next) => update("password", next)}
					/>
					{allowGecko && (
						<TextField
							label="Gecko packet size"
							value={settings.packetSize}
							placeholder="512-1200"
							onChange={(next) => update("packetSize", next)}
						/>
					)}
				</div>
			);
		case "sudoku":
			return <SudokuSettings settings={settings} onChange={onChange} />;
		case "xdns":
			return (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<StringArrayField
						label="Domains"
						value={settings.domains}
						placeholder="t.example.com:txt"
						onChange={(next) => update("domains", next)}
					/>
					<StringArrayField
						label="Resolvers"
						value={settings.resolvers}
						placeholder="t.example.com+udp://8.8.8.8:53"
						onChange={(next) => update("resolvers", next)}
					/>
				</div>
			);
		case "xicmp":
			return (
				<div className="flex flex-col gap-3">
					<BooleanField
						label="Datagram mode"
						value={settings.dgram}
						onChange={(next) => update("dgram", next)}
					/>
					<StringArrayField
						label="IP addresses"
						value={settings.ips}
						placeholder="203.0.113.1"
						onChange={(next) => update("ips", next)}
					/>
				</div>
			);
		case "realm":
			return (
				<div className="flex flex-col gap-3">
					<TextField
						label="Realm URL"
						value={settings.url}
						placeholder="realm://token@example.com/id"
						onChange={(next) => update("url", next)}
					/>
					<StringArrayField
						label="STUN servers"
						value={settings.stunServers}
						placeholder="stun.example.com:3478"
						onChange={(next) => update("stunServers", next)}
					/>
					<RealmTlsSettings
						value={settings.tlsConfig}
						onChange={(next) => update("tlsConfig", next)}
					/>
				</div>
			);
		default:
			return null;
	}
};

const LayerSettings: FC<{
	direction: Direction;
	layer: FinalMaskLayer;
	onChange: (value: FinalMaskLayer) => void;
	allowGecko: boolean;
}> = ({ direction, layer, onChange, allowGecko }) => {
	const settings = asRecord(layer.settings);
	const update = (next: FinalMaskSettings) =>
		onChange({ ...layer, settings: next });
	if (direction === "udp") {
		return (
			<UdpSettings
				type={layer.type}
				settings={settings}
				onChange={update}
				allowGecko={allowGecko}
			/>
		);
	}
	switch (layer.type) {
		case "header-custom":
			return (
				<HeaderCustomSettings settings={settings} onChange={update} direction="tcp" />
			);
		case "fragment":
			return <FragmentSettings settings={settings} onChange={update} />;
		case "sudoku":
			return <SudokuSettings settings={settings} onChange={update} />;
		default:
			return null;
	}
};

const LayerCollection: FC<{
	direction: Direction;
	types: string[];
	value: FinalMaskLayer[];
	onChange: (value: FinalMaskLayer[]) => void;
	allowGecko?: boolean;
}> = ({ direction, types, value, onChange, allowGecko = false }) => {
	const { t } = useTranslation();
	const firstUdpType = value.find((layer) => UDP_FIRST_TYPES.has(layer.type));
	const availableTypes = types.filter(
		(type) =>
			direction !== "udp" ||
			((!UDP_FIRST_TYPES.has(type) || !firstUdpType) &&
				(type !== "sudoku" || !value.some((layer) => layer.type === "sudoku"))),
	);
	const [pendingType, setPendingType] = useState(availableTypes[0] ?? "");
	const selectedType = availableTypes.includes(pendingType)
		? pendingType
		: (availableTypes[0] ?? "");
	const emit = (layers: FinalMaskLayer[]) =>
		onChange(direction === "udp" ? normalizeUdpLayers(layers) : layers);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex-col md:flex-row flex items-stretch md:items-center justify-between gap-2">
				<div>
					<p className="font-semibold">
						{direction === "tcp" ? "TCP connection masks" : "UDP packet masks"}
					</p>
					<p className="text-[0.75rem] text-gray-500">
						Add only what you need. Layer 1 runs closest to the original
						traffic.
					</p>
				</div>
				<div className="flex flex-row gap-2 items-stretch">
					<div className="min-w-0! md:min-w-[190px]! flex-1">
						<SearchableTagSelect
							value={selectedType}
							options={availableTypes.map((type) => ({
								value: type,
								label: typeLabel(type),
							}))}
							placeholder="Mask type"
							onChange={(next) => setPendingType(String(next))}
						/>
					</div>
					<Button disabled={!selectedType} onClick={() =>
							emit([...value, createFinalMaskLayer(direction, selectedType)])
						} size="sm">{<Plus className="w-[14px]" />}
						{t("add")}
					</Button>
				</div>
			</div>
			{value.length === 0 && (
				<div className="border border-dashed rounded-lg p-4">
					<p className="text-[0.875rem] font-medium">
						No {direction.toUpperCase()} mask is active
					</p>
					<p className="mt-1 text-[0.75rem] text-gray-500">
						Choose a mask type above and select Add. Safe starter values are
						filled in automatically.
					</p>
				</div>
			)}
			{value.map((layer, index) => (
				<div key={`${layer.type}-${index}-${value.length}`} className="flex flex-col gap-3 border rounded-lg p-3">
					<div className="flex items-center justify-between gap-2">
						<div className="flex flex-row items-center gap-2">
							<Badge className={toneClass(direction === "tcp" ? "blue" : "purple")}>
								#{index + 1}
							</Badge>
							<p className="text-[0.875rem] font-semibold">
								{typeLabel(layer.type)}
							</p>
						</div>
						<OrderButtons
							index={index}
							length={value.length}
							disableUp={
								direction === "udp" &&
								(UDP_FIRST_TYPES.has(layer.type) ||
									layer.type === "sudoku" ||
									(index === 1 && Boolean(firstUdpType)))
							}
							disableDown={
								direction === "udp" &&
								(UDP_FIRST_TYPES.has(layer.type) ||
									layer.type === "sudoku" ||
									(index === value.length - 2 &&
										value[value.length - 1]?.type === "sudoku"))
							}
							onMove={(from, to) => emit(moveItem(value, from, to))}
							onRemove={() =>
								emit(value.filter((_, itemIndex) => itemIndex !== index))
							}
						/>
					</div>
					<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
					<p className="text-[0.75rem] text-gray-500">
						{typeDescription(layer.type)}
					</p>
					<LayerSettings
						direction={direction}
						layer={layer}
						allowGecko={allowGecko}
						onChange={(nextLayer) => {
							const next = [...value];
							next[index] = nextLayer;
							emit(next);
						}}
					/>
				</div>
			))}
		</div>
	);
};

const QUIC_NUMBER_FIELDS: Array<{
	key: string;
	label: string;
	min?: number;
	max?: number;
	placeholder: string;
}> = [
	{
		key: "initStreamReceiveWindow",
		label: "Initial stream receive window",
		placeholder: "8388608",
	},
	{
		key: "maxStreamReceiveWindow",
		label: "Maximum stream receive window",
		placeholder: "8388608",
	},
	{
		key: "initConnectionReceiveWindow",
		label: "Initial connection receive window",
		placeholder: "20971520",
	},
	{
		key: "maxConnectionReceiveWindow",
		label: "Maximum connection receive window",
		placeholder: "20971520",
	},
	{
		key: "maxIdleTimeout",
		label: "Maximum idle timeout (s)",
		min: 4,
		max: 120,
		placeholder: "30",
	},
	{
		key: "keepAlivePeriod",
		label: "Keep-alive period (s)",
		min: 2,
		max: 60,
		placeholder: "10",
	},
	{
		key: "maxIncomingStreams",
		label: "Maximum incoming streams",
		min: 8,
		placeholder: "1024",
	},
];

const QuicParamsEditor: FC<{
	value: unknown;
	onChange: (value: FinalMaskSettings | undefined) => void;
	allowUdpHop: boolean;
	allowNegotiatedBrutal: boolean;
}> = ({ value, onChange, allowUdpHop, allowNegotiatedBrutal }) => {
	const enabled =
		typeof value === "object" && value !== null && !Array.isArray(value);
	const params = asRecord(value);
	const udpHopEnabled =
		typeof params.udpHop === "object" &&
		params.udpHop !== null &&
		!Array.isArray(params.udpHop);
	const udpHop = asRecord(params.udpHop);
	const configuredCongestion = textValue(params.congestion).toLowerCase();
	const congestion =
		!allowNegotiatedBrutal && configuredCongestion === "brutal"
			? ""
			: configuredCongestion;
	const update = (key: string, next: unknown) => {
		const updated = setKey(params, key, next);
		if (
			!allowUdpHop &&
			typeof asRecord(updated.udpHop).ports === "string" &&
			String(asRecord(updated.udpHop).ports).trim()
		) {
			delete updated.udpHop;
		}
		if (
			!allowNegotiatedBrutal &&
			textValue(updated.congestion).toLowerCase() === "brutal"
		) {
			delete updated.congestion;
		}
		onChange(updated);
	};
	const updateHop = (key: string, next: unknown) =>
		update("udpHop", setKey(udpHop, key, next));
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					<p className="font-semibold">QUIC parameters</p>
					<p className="text-[0.75rem] text-gray-500">
						Used by Hysteria and XHTTP H3.
					</p>
				</div>
				<Switch aria-label="Enable QUIC parameters" checked={enabled} onCheckedChange={(checked: boolean) => {
						const activeHop = Boolean(
							typeof udpHop.ports === "string" && udpHop.ports.trim(),
						);
						const compatible =
							allowUdpHop || !activeHop
								? params
								: setKey(params, "udpHop", undefined);
						onChange(checked ? compatible : undefined);
					}} />
			</div>
			<Collapsible open={enabled}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-3 pt-1">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<SelectField
							label="Congestion control"
							value={congestion}
							options={[
								{ value: "", label: "Transport default" },
								"reno",
								"bbr",
								...(allowNegotiatedBrutal ? ["brutal"] : []),
								"force-brutal",
							]}
							onChange={(next) => update("congestion", next)}
						/>
						<SelectField
							label="BBR profile"
							value={textValue(params.bbrProfile).toLowerCase()}
							options={[
								{ value: "", label: "Standard (default)" },
								"conservative",
								"standard",
								"aggressive",
							]}
							onChange={(next) => update("bbrProfile", next)}
						/>
						{["brutal", "force-brutal"].includes(congestion) && (
							<TextField
								label="Brutal upload rate"
								value={params.brutalUp}
								placeholder="60 mbps"
								onChange={(next) => update("brutalUp", next)}
							/>
						)}
						{allowNegotiatedBrutal &&
							["brutal", "force-brutal"].includes(congestion) && (
								<TextField
									label="Brutal download rate"
									value={params.brutalDown}
									placeholder="100 mbps"
									onChange={(next) => update("brutalDown", next)}
								/>
							)}
					</div>
					<div className="flex flex-row items-center gap-6 flex-wrap">
						<BooleanField
							label="Debug logging"
							value={params.debug}
							onChange={(next) => update("debug", next)}
						/>
						<BooleanField
							label="Disable path MTU discovery"
							value={params.disablePathMTUDiscovery}
							onChange={(next) => update("disablePathMTUDiscovery", next)}
						/>
						{allowUdpHop && (
							<BooleanField
								label="UDP port hopping"
								value={udpHopEnabled}
								onChange={(next) => update("udpHop", next ? udpHop : undefined)}
							/>
						)}
					</div>
					{allowUdpHop && udpHopEnabled && (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
							<TextField
								label="Hop ports"
								value={udpHop.ports}
								placeholder="20000-50000"
								onChange={(next) => updateHop("ports", next)}
							/>
							<TextField
								label="Hop interval (s)"
								value={udpHop.interval}
								placeholder="5-10"
								onChange={(next) => updateHop("interval", next)}
							/>
						</div>
					)}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						{QUIC_NUMBER_FIELDS.map((field) => (
							<NumberField
								key={field.key}
								label={field.label}
								value={params[field.key]}
								min={field.min}
								max={field.max}
								placeholder={field.placeholder}
								onChange={(next) => update(field.key, next)}
							/>
						))}
					</div>
				</div>
			</CollapsibleContent></Collapsible>
		</div>
	);
};

export const FinalMaskEditor: FC<FinalMaskEditorProps> = ({
	value,
	onChange,
	capabilities,
}) => {
	const { t } = useTranslation();
	if (!capabilities.supported) return null;
	const current = value ?? {};
	const hasExclusiveUdp = Array.isArray(current.udp)
		? current.udp.some((layer) => UDP_FIRST_TYPES.has(layer.type))
		: false;
	const allowNegotiatedBrutal = capabilities.allowNegotiatedBrutal;
	const updateSection = (direction: Direction, layers: FinalMaskLayer[]) => {
		const next = { ...current };
		if (layers.length) next[direction] = layers;
		else delete next[direction];
		if (
			direction === "udp" &&
			layers.some((layer) => UDP_FIRST_TYPES.has(layer.type)) &&
			typeof next.quicParams === "object" &&
			next.quicParams !== null &&
			!Array.isArray(next.quicParams) &&
			typeof asRecord(asRecord(next.quicParams).udpHop).ports === "string" &&
			String(asRecord(asRecord(next.quicParams).udpHop).ports).trim()
		) {
			const quicParams = setKey(asRecord(next.quicParams), "udpHop", undefined);
			if (Object.keys(quicParams).length) next.quicParams = quicParams;
			else delete next.quicParams;
		}
		onChange(next);
	};
	const updateQuic = (quicParams: FinalMaskSettings | undefined) => {
		const next = { ...current };
		if (quicParams === undefined) delete next.quicParams;
		else next.quicParams = quicParams;
		onChange(next);
	};
	return (
		<div className="flex flex-col gap-4">
			<div className="border rounded-lg p-3">
				<p className="text-[0.75rem] text-gray-500">
					{t("hostsDialog.finalMaskHint")}
				</p>
			</div>
			<div className="flex flex-col gap-5">
				{capabilities.tcp && (
					<LayerCollection types={capabilities.tcpTypes} value={Array.isArray(current.tcp) ? current.tcp : []} onChange={(layers) => updateSection("tcp", layers)} direction="tcp" />
				)}
				{capabilities.udp && (
					<LayerCollection types={capabilities.udpTypes} value={Array.isArray(current.udp) ? current.udp : []} allowGecko={capabilities.quic} onChange={(layers) => updateSection("udp", layers)} direction="udp" />
				)}
				{capabilities.quic && (
					<QuicParamsEditor
						value={current.quicParams}
						allowUdpHop={!hasExclusiveUdp}
						allowNegotiatedBrutal={allowNegotiatedBrutal}
						onChange={updateQuic}
					/>
				)}
			</div>
		</div>
	);
};
