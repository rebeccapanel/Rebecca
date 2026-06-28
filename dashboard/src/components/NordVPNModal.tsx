import {
	Alert,
	AlertDescription,
	AlertIcon,
	Badge,
	Box,
	Button,
	Divider,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Select,
	SimpleGrid,
	Spinner,
	Stack,
	Table,
	Tag,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	CloudArrowDownIcon,
	KeyIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
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
	isOpen: boolean;
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
	isOpen,
	onClose,
	initialOutbounds,
	onSave,
	onDelete,
}) => {
	const { t } = useTranslation();
	const toast = useToast();
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
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.nord.loadFailed", "Unable to load NordVPN data"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
			toast({
				title: t("pages.xray.nord.loginSuccess", "NordVPN credentials saved"),
				status: "success",
				isClosable: true,
				position: "top",
			});
		} catch (error: any) {
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.nord.loginFailed", "Unable to register NordVPN token"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
			toast({
				title: t("pages.xray.nord.keySaved", "NordVPN private key saved"),
				status: "success",
				isClosable: true,
				position: "top",
			});
		} catch (error: any) {
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.nord.keyFailed", "Unable to save NordVPN private key"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.nord.deleteFailed", "Unable to delete NordVPN data"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
				toast({
					title: t("pages.xray.nord.noServers", "No NordVPN server found"),
					status: "warning",
					isClosable: true,
					position: "top",
				});
			}
		} catch (error: any) {
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.nord.serversFailed", "Unable to load NordVPN servers"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
			toast({
				title: t("pages.xray.nord.noPublicKey", "NordVPN server is missing a public key"),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
		toast({
			title:
				nordOutboundIndex >= 0
					? t("pages.xray.nord.outboundUpdated", "NordVPN outbound updated")
					: t("pages.xray.nord.outboundAdded", "NordVPN outbound added"),
			status: "success",
			isClosable: true,
			position: "top",
		});
		onClose();
	};

	const selectedServer = servers.find((item) => String(item.id) === serverID);

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="3xl" isCentered>
			<ModalOverlay />
			<XrayModalContent>
				<XrayModalHeader>NordVPN NordLynx</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<VStack spacing={4} align="stretch">
						{loading && (
							<HStack>
								<Spinner size="sm" />
								<Text fontSize="sm" color="gray.500">
									{t("loading", "Loading...")}
								</Text>
							</HStack>
						)}
						{!nordData?.private_key ? (
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<Box borderWidth="1px" borderRadius="md" p={4}>
									<Stack spacing={3}>
										<Text fontWeight="bold">
											{t("pages.xray.nord.accessToken", "Access token")}
										</Text>
										<FormControl>
											<FormLabel>{t("pages.xray.nord.token", "Token")}</FormLabel>
											<Input
												value={token}
												onChange={(event) => setToken(event.target.value)}
												placeholder="NordVPN access token"
											/>
											<FormHelperText>
												{t(
													"pages.xray.nord.tokenHelp",
													"Rebecca uses this token once to fetch your NordLynx private key.",
												)}
											</FormHelperText>
										</FormControl>
										<Button
											leftIcon={<KeyIcon width={16} />}
											isLoading={loading}
											onClick={register}
											colorScheme="primary"
										>
											{t("login", "Login")}
										</Button>
									</Stack>
								</Box>
								<Box borderWidth="1px" borderRadius="md" p={4}>
									<Stack spacing={3}>
										<Text fontWeight="bold">
											{t("pages.xray.nord.manualKey", "Manual private key")}
										</Text>
										<FormControl>
											<FormLabel>
												{t("pages.xray.nord.privateKey", "Private key")}
											</FormLabel>
											<Input
												value={manualKey}
												onChange={(event) => setManualKey(event.target.value)}
												placeholder="NordLynx private key"
											/>
										</FormControl>
										<Button
											leftIcon={<CloudArrowDownIcon width={16} />}
											isLoading={loading}
											onClick={saveManualKey}
										>
											{t("save", "Save")}
										</Button>
									</Stack>
								</Box>
							</SimpleGrid>
						) : (
							<Stack spacing={4}>
								<Alert status="success" borderRadius="md">
									<AlertIcon />
									<AlertDescription>
										{t(
											"pages.xray.nord.ready",
											"NordVPN private key is configured. Select a country and server to create a WireGuard outbound.",
										)}
									</AlertDescription>
								</Alert>
								<Table size="sm" variant="simple">
									<Thead>
										<Tr>
											<Th>{t("field", "Field")}</Th>
											<Th>{t("value", "Value")}</Th>
										</Tr>
									</Thead>
									<Tbody>
										{nordData.token && (
											<Tr>
												<Td>{t("pages.xray.nord.accessToken", "Access token")}</Td>
												<Td>
													<Badge colorScheme="green">
														{t("configured", "Configured")}
													</Badge>
												</Td>
											</Tr>
										)}
										<Tr>
											<Td>{t("pages.xray.nord.privateKey", "Private key")}</Td>
											<Td>
												<Text noOfLines={1} fontFamily="mono" fontSize="xs">
													{nordData.private_key}
												</Text>
											</Td>
										</Tr>
									</Tbody>
								</Table>
								<Button
									leftIcon={<TrashIcon width={16} />}
									colorScheme="red"
									variant="outline"
									alignSelf="flex-start"
									isLoading={loading}
									onClick={deleteData}
								>
									{t("logout", "Logout")}
								</Button>
								<Divider />
								<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
									<FormControl>
										<FormLabel>{t("pages.xray.outbound.country", "Country")}</FormLabel>
										<Select
											value={countryID}
											onChange={(event) => void fetchServers(event.target.value)}
										>
											<option value="">
												{t("select", "Select")}
											</option>
											{countries.map((country) => (
												<option key={country.id} value={country.id}>
													{country.name}
													{country.code ? ` (${country.code})` : ""}
												</option>
											))}
										</Select>
									</FormControl>
									<FormControl isDisabled={cities.length === 0}>
										<FormLabel>{t("pages.xray.outbound.city", "City")}</FormLabel>
										<Select
											value={cityID}
											onChange={(event) => setCityID(event.target.value)}
										>
											<option value="">
												{t("pages.xray.outbound.allCities", "All cities")}
											</option>
											{cities.map((city) => (
												<option key={city.id} value={city.id}>
													{city.name}
												</option>
											))}
										</Select>
									</FormControl>
									<FormControl isDisabled={filteredServers.length === 0}>
										<FormLabel>{t("pages.xray.outbound.server", "Server")}</FormLabel>
										<Select
											value={serverID}
											onChange={(event) => setServerID(event.target.value)}
										>
											<option value="">
												{t("select", "Select")}
											</option>
											{filteredServers.map((server) => (
												<option key={server.id} value={server.id}>
													{server.cityName} - {server.name ?? server.hostname} ({server.load}%)
												</option>
											))}
										</Select>
									</FormControl>
								</SimpleGrid>
								{selectedServer && (
									<HStack spacing={2} flexWrap="wrap">
										<Tag colorScheme={loadColor(selectedServer.load)}>
											{selectedServer.load}% load
										</Tag>
										<Tag>{selectedServer.hostname}</Tag>
										<Tag>{selectedServer.station}:51820</Tag>
									</HStack>
								)}
							</Stack>
						)}
					</VStack>
				</XrayModalBody>
				<XrayModalFooter>
					<Button variant="ghost" onClick={onClose}>
						{t("close")}
					</Button>
					{nordData?.private_key && (
						<>
							<Button
								leftIcon={<ArrowPathIcon width={16} />}
								isDisabled={!serverID}
								onClick={saveOutbound}
								colorScheme="primary"
							>
								{nordOutboundIndex >= 0
									? t("pages.xray.nord.updateOutbound", "Update outbound")
									: t("pages.xray.nord.addOutbound", "Add outbound")}
							</Button>
							{nordOutboundIndex >= 0 && (
								<Button
									colorScheme="red"
									variant="outline"
									onClick={() => onDelete(nordOutboundIndex)}
								>
									{t("delete", "Delete")}
								</Button>
							)}
						</>
					)}
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
