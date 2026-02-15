import {
	Box,
	Button,
	HStack,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Spacer,
	Tag,
	Text,
	VStack,
} from "@chakra-ui/react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";

type DnsPreset = {
	name: string;
	family: boolean;
	servers: string[];
};

const DNS_PRESETS: DnsPreset[] = [
	{
		name: "Google DNS",
		family: false,
		servers: [
			"8.8.8.8",
			"8.8.4.4",
			"2001:4860:4860::8888",
			"2001:4860:4860::8844",
		],
	},
	{
		name: "Cloudflare DNS",
		family: false,
		servers: [
			"1.1.1.1",
			"1.0.0.1",
			"2606:4700:4700::1111",
			"2606:4700:4700::1001",
		],
	},
	{
		name: "Adguard DNS",
		family: false,
		servers: [
			"94.140.14.14",
			"94.140.15.15",
			"2a10:50c0::ad1:ff",
			"2a10:50c0::ad2:ff",
		],
	},
	{
		name: "Adguard Family DNS",
		family: true,
		servers: [
			"94.140.14.14",
			"94.140.15.15",
			"2a10:50c0::ad1:ff",
			"2a10:50c0::ad2:ff",
		],
	},
	{
		name: "Cloudflare Family DNS",
		family: true,
		servers: [
			"1.1.1.3",
			"1.0.0.3",
			"2606:4700:4700::1113",
			"2606:4700:4700::1003",
		],
	},
];

interface DnsPresetsModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectPreset: (servers: string[]) => void;
}

export const DnsPresetsModal: FC<DnsPresetsModalProps> = ({
	isOpen,
	onClose,
	onSelectPreset,
}) => {
	const { t } = useTranslation();

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="md">
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3">
				<ModalHeader pt={6}>
					<Text fontWeight="semibold" fontSize="lg">
						{t("pages.xray.dns.dnsPresetTitle", "DNS Presets")}
					</Text>
				</ModalHeader>
				<ModalCloseButton mt={3} />
				<ModalBody pb={6}>
					<VStack spacing={3} align="stretch">
						{DNS_PRESETS.map((preset) => (
							<Box key={preset.name} borderWidth="1px" borderRadius="md" p={3}>
								<HStack spacing={3}>
									<Tag
										colorScheme={preset.family ? "purple" : "green"}
										size="sm"
									>
										{preset.family
											? t("pages.xray.dns.dnsPresetFamily", "Family")
											: t("DNS", "DNS")}
									</Tag>
									<Text fontWeight="semibold">{preset.name}</Text>
									<Spacer />
									<Button
										size="xs"
										colorScheme="primary"
										onClick={() => {
											onSelectPreset(preset.servers);
											onClose();
										}}
									>
										{t("install")}
									</Button>
								</HStack>
							</Box>
						))}
					</VStack>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};
