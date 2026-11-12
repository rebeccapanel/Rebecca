import { toneClass } from "lib/tone";
import { Spinner } from "components/ui/spinner";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Alert, AlertDescription } from "components/ui/alert";
import { Badge } from "components/ui/badge";
import { Dialog } from "components/ui/dialog";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";
import { RefreshCw, CloudDownload, Key, Trash2 } from "lucide-react";

import { PanelSelect as Select } from "components/common/PanelSelect";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type OutboundJson = Record<string, any>;

type NordAPIResponse = {
	success?: boolean;
	obj?: string;
	detail?: string;
};

type NordData = {
	token?: string;
	private_key?: string;
};

type Country = {
	id: number;
	name: string;
	code?: string;
};

type City = {
	id: number;
	name: string;
};

type NordServer = {
	id: number;
	name?: string;
	hostname: string;
	station: string;
	load: number;
	technologies?: Array<{
		id?: number;
		metadata?: Array<{ name?: string; value?: string }>;
	}>;
	location_ids?: number[];
	cityId?: number | null;
	cityName?: string;
};

type Props = {
	open: boolean;
	onClose: () => void;
	initialOutbounds: OutboundJson[];
	onSave: (outbound: OutboundJson, replaceIndex: number | null) => void;
	onDelete: (index: number) => void;
};

const parseAPIError = (error: any, fallback: string) =>
	error?.response?._data?.detail ??
	error?.data?.detail ??
	error?.message ??
	fallback;

const parseObj = <T,>(response: NordAPIResponse, fallback: T): T => {
	if (!response?.obj) return fallback;
	try {
		return JSON.parse(response.obj) as T;
	} catch {
		return fallback;
	}
};

const loadColor = (load: number) => {
	if (load < 30) return "green";
	if (load < 70) return "orange";
	return "red";
};

export const NordVPNModal: FC<Props> = ({
	open: isOpen,
	onClose,
	initialOutbounds,
	onSave,
	onDelete,
}) => {
	const { t } = useTranslation();
	
	const [loading, setLoading] = useState(false);
	const [nordData, setNordData] = useState<NordData | null>(null);
	const [token, setToken] = useState("");
	const [manualKey, setManualKey] = useState("");
	const [countries, setCountries] = useState<Country[]>([]);
	const [cities, setCities] = useState<City[]>([]);
	const [servers, setServers] = useState<NordServer[]>([]);
	const [countryID, setCountryID] = useState("");
	const [cityID, setCityID] = useState("");
	const [serverID, setServerID] = useState("");

	const nordOutboundIndex = useMemo(
		() =>
			initialOutbounds.findIndex((outbound) =>
				String(outbound?.tag ?? "").startsWith("nord-"),
			),
		[initialOutbounds],
	);

	const filteredServers = useMemo(() => {
		if (!cityID) return servers;
		return servers.filter((server) => String(server.cityId ?? "") === cityID);
	}, [cityID, servers]);

	useEffect(() => {
		setServerID(filteredServers[0]?.id ? String(filteredServers[0].id) : "");
	}, [filteredServers]);

	const fetchCountries = useCallback(async () => {
		const response = await apiFetch<NordAPIResponse>(
			"/panel/xray/nord/countries",
			{ method: "POST" },
		);
		setCountries(parseObj<Country[]>(response, []));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiFetch<NordAPIResponse>("/panel/xray/nord/data", {
				method: "POST",
			});
			const next = parseObj<NordData | null>(response, null);
			setNordData(next);
			if (next?.private_key) {
				await fetchCountries();
			}
		} catch (error: any) {
			toast.error(parseAPIError(
					error,
					t("pages.xray.nord.loadFailed"),
				));
		} finally {
			setLoading(false);
		}
	}, [fetchCountries, t, toast]);

	useEffect(() => {
		if (isOpen) {
			void loadData();
		}
	}, [isOpen, loadData]);

	const register = async () => {
		setLoading(true);
		try {
			const response = await apiFetch<NordAPIResponse>("/panel/xray/nord/reg", {
				method: "POST",
				body: { token },
			});
			const next = parseObj<NordData | null>(response, null);
			setNordData(next);
			await fetchCountries();
			toast.success(t("pages.xray.nord.loginSuccess"));
		} catch (error: any) {
			toast.error(parseAPIError(
					error,
					t("pages.xray.nord.loginFailed"),
				));
		} finally {
			setLoading(false);
		}
	};

	const saveManualKey = async () => {
		setLoading(true);
		try {
			const response = await apiFetch<NordAPIResponse>("/panel/xray/nord/setKey", {
				method: "POST",
				body: { key: manualKey },
			});
			const next = parseObj<NordData | null>(response, null);
			setNordData(next);
			await fetchCountries();
			toast.success(t("pages.xray.nord.keySaved"));
		} catch (error: any) {
			toast.error(parseAPIError(
					error,
					t("pages.xray.nord.keyFailed"),
				));
		} finally {
			setLoading(false);
		}
	};

	const deleteData = async () => {
		setLoading(true);
		try {
			await apiFetch<NordAPIResponse>("/panel/xray/nord/del", {
				method: "POST",
			});
			if (nordOutboundIndex >= 0) {
				onDelete(nordOutboundIndex);
			}
			setNordData(null);
			setToken("");
			setManualKey("");
			setCountries([]);
			setCities([]);
			setServers([]);
			setCountryID("");
			setCityID("");
			setServerID("");
		} catch (error: any) {
			toast.error(parseAPIError(
					error,
					t("pages.xray.nord.deleteFailed"),
				));
		} finally {
			setLoading(false);
		}
	};

	const fetchServers = async (nextCountryID: string) => {
		setCountryID(nextCountryID);
		setCityID("");
		setServerID("");
		setServers([]);
		setCities([]);
		if (!nextCountryID) return;
		setLoading(true);
		try {
			const response = await apiFetch<NordAPIResponse>("/panel/xray/nord/servers", {
				method: "POST",
				body: { countryId: nextCountryID },
			});
			const data = parseObj<{ locations?: any[]; servers?: NordServer[] }>(
				response,
				{},
			);
			const locToCity: Record<number, City> = {};
			const cityMap = new Map<number, City>();
			for (const loc of data.locations ?? []) {
				const city = loc?.country?.city;
				if (city?.id && city?.name) {
					locToCity[loc.id] = city;
					cityMap.set(city.id, city);
				}
			}
			const nextServers = (data.servers ?? [])
				.map((server) => {
					const firstLocID = server.location_ids?.[0];
					const city =
						typeof firstLocID === "number" ? locToCity[firstLocID] : undefined;
					return {
						...server,
						cityId: city?.id ?? null,
						cityName: city?.name ?? "Unknown",
					};
				})
				.sort((a, b) => (a.load ?? 0) - (b.load ?? 0));
			setCities(
				Array.from(cityMap.values()).sort((a, b) =>
					a.name.localeCompare(b.name),
				),
			);
			setServers(nextServers);
			if (nextServers.length === 0) {
				toast.warning(t("pages.xray.nord.noServers"));
			}
		} catch (error: any) {
			toast.error(parseAPIError(
					error,
					t("pages.xray.nord.serversFailed"),
				));
		} finally {
			setLoading(false);
		}
	};

	const buildOutbound = (): OutboundJson | null => {
		const server = servers.find((item) => String(item.id) === serverID);
		if (!server) return null;
		const technology = server.technologies?.find((item) => item.id === 35);
		const publicKey = technology?.metadata?.find(
			(item) => item.name === "public_key",
		)?.value;
		if (!publicKey) {
			toast.error(t("pages.xray.nord.noPublicKey"));
			return null;
		}
		return {
			tag: `nord-${server.hostname}`,
			protocol: "wireguard",
			settings: {
				secretKey: nordData?.private_key,
				address: ["10.5.0.2/32"],
				peers: [{ publicKey, endpoint: `${server.station}:51820` }],
				noKernelTun: true,
			},
		};
	};

	const saveOutbound = () => {
		const outbound = buildOutbound();
		if (!outbound) return;
		onSave(outbound, nordOutboundIndex >= 0 ? nordOutboundIndex : null);
		toast.success(nordOutboundIndex >= 0
					? t("pages.xray.nord.outboundUpdated")
					: t("pages.xray.nord.outboundAdded"));
		onClose();
	};

	const selectedServer = servers.find((item) => String(item.id) === serverID);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<XrayModalHeader>NordVPN NordLynx</XrayModalHeader>
				
				<XrayModalBody>
					<div className="flex flex-col gap-4 items-stretch">
						{loading && (
							<div className="flex flex-row items-center gap-2">
								<Spinner />
								<p className="text-[0.875rem] text-gray-500">
									{t("loading")}
								</p>
							</div>
						)}
						{!nordData?.private_key ? (
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="border rounded-md p-4">
									<div className="flex flex-col gap-3">
										<p className="font-bold">
											{t("pages.xray.warp.accessToken")}
										</p>
										<Field>
											<FieldLabel>{t("userDialog.links.subscriptionToken")}</FieldLabel>
											<Input value={token} onChange={(event) => setToken(event.target.value)} />
											<FieldDescription>
												{t("pages.xray.nord.tokenHelp")}
											</FieldDescription>
										</Field>
										<Button onClick={register} loading={loading}>{<Key className="w-[16px]" />}
											{t("login")}
										</Button>
									</div>
								</div>
								<div className="border rounded-md p-4">
									<div className="flex flex-col gap-3">
										<p className="font-bold">
											{t("pages.xray.nord.manualKey")}
										</p>
										<Field>
											<FieldLabel>
												{t("inbounds.wireguard.privateKey")}
											</FieldLabel>
											<Input value={manualKey} onChange={(event) => setManualKey(event.target.value)} />
										</Field>
										<Button onClick={saveManualKey} loading={loading}>{<CloudDownload className="w-[16px]" />}
											{t("save")}
										</Button>
									</div>
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-4">
								<Alert className="rounded-md">
									<CircleCheck className="size-4" aria-hidden="true" />
									<AlertDescription>
										{t("pages.xray.nord.ready")}
									</AlertDescription>
								</Alert>
								<table className="w-full border-separate border-spacing-0">
									<thead>
										<tr>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("field")}</th>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("value")}</th>
										</tr>
									</thead>
									<tbody>
										{nordData.token && (
											<tr>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">{t("pages.xray.warp.accessToken")}</td>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													<Badge className="bg-green-600 text-white">
														{t("configured")}
													</Badge>
												</td>
											</tr>
										)}
										<tr>
											<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">{t("inbounds.wireguard.privateKey")}</td>
											<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
												<p className="truncate font-mono text-[0.75rem]">
													{nordData.private_key}
												</p>
											</td>
										</tr>
									</tbody>
								</table>
								<Button onClick={deleteData} variant="outline" loading={loading} className={cn("border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10", "self-start")}>{<Trash2 className="w-[16px]" />}
									{t("logout.variant2")}
								</Button>
								<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
								<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
									<Field>
										<FieldLabel>{t("pages.xray.outbound.country")}</FieldLabel>
										<Select
											value={countryID}
											onChange={(event) => void fetchServers(event.target.value)}
										>
											<option value="">
												{t("select")}
											</option>
											{countries.map((country) => (
												<option key={country.id} value={country.id}>
													{country.name}
													{country.code ? ` (${country.code})` : ""}
												</option>
											))}
										</Select>
									</Field>
									<Field>
										<FieldLabel>{t("pages.xray.outbound.city")}</FieldLabel>
										<Select
											value={cityID}
											onChange={(event) => setCityID(event.target.value)}
										>
											<option value="">
												{t("pages.xray.outbound.allCities")}
											</option>
											{cities.map((city) => (
												<option key={city.id} value={city.id}>
													{city.name}
												</option>
											))}
										</Select>
									</Field>
									<Field>
										<FieldLabel>{t("pages.xray.outbound.server")}</FieldLabel>
										<Select
											value={serverID}
											onChange={(event) => setServerID(event.target.value)}
										>
											<option value="">
												{t("select")}
											</option>
											{filteredServers.map((server) => (
												<option key={server.id} value={server.id}>
													{server.cityName} - {server.name ?? server.hostname} ({server.load}%)
												</option>
											))}
										</Select>
									</Field>
								</div>
								{selectedServer && (
									<div className="flex flex-row items-center gap-2 flex-wrap">
										<Badge className={toneClass(loadColor(selectedServer.load))}>
											{selectedServer.load}% load
										</Badge>
										<Badge>{selectedServer.hostname}</Badge>
										<Badge>{selectedServer.station}:51820</Badge>
									</div>
								)}
							</div>
						)}
					</div>
				</XrayModalBody>
				<XrayModalFooter>
					<Button onClick={onClose} variant="ghost">
						{t("close")}
					</Button>
					{nordData?.private_key && (
						<>
							<Button disabled={!serverID} onClick={saveOutbound}>{<RefreshCw className="w-[16px]" />}
								{nordOutboundIndex >= 0
									? t("pages.xray.nord.updateOutbound")
									: t("pages.xray.nord.addOutbound")}
							</Button>
							{nordOutboundIndex >= 0 && (
								<Button onClick={() => onDelete(nordOutboundIndex)} variant="outline" className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">
									{t("delete")}
								</Button>
							)}
						</>
					)}
				</XrayModalFooter>
			</XrayModalContent>
		</Dialog>
	);
};
