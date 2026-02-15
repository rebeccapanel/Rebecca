import {
	Box,
	chakra,
	HStack,
	IconButton,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Text,
	VStack,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	QrCodeIcon,
} from "@heroicons/react/24/outline";
import SlickSlider from "components/common/SlickSlider";
import { QRCodeCanvas } from "qrcode.react";
import { type FC, useEffect, useMemo, useState } from "react";
import CopyToClipboard from "react-copy-to-clipboard";
import { useTranslation } from "react-i18next";
import "slick-carousel/slick/slick-theme.css";
import "slick-carousel/slick/slick.css";
import { getConfigLabelFromLink } from "utils/configLabel";
import { useDashboard } from "../contexts/DashboardContext";
import { Icon } from "./Icon";

const QRCode = chakra(QRCodeCanvas);
const NextIcon = chakra(ChevronRightIcon, {
	baseStyle: {
		w: 6,
		h: 6,
		color: "gray.600",
		_dark: {
			color: "white",
		},
	},
});
const PrevIcon = chakra(ChevronLeftIcon, {
	baseStyle: {
		w: 6,
		h: 6,
		color: "gray.600",
		_dark: {
			color: "white",
		},
	},
});
const QRIcon = chakra(QrCodeIcon, {
	baseStyle: {
		w: 5,
		h: 5,
	},
});

const clickPulse = keyframes`
	0% { transform: scale(1); }
	40% { transform: scale(0.94); }
	70% { transform: scale(1.04); }
	100% { transform: scale(1); }
`;

export const QRCodeDialog: FC = () => {
	const { QRcodeLinks, setQRCode, setSubLink, subscribeUrl } = useDashboard();
	const isOpen = QRcodeLinks !== null;
	const [index, setIndex] = useState(0);
	const [copiedSub, setCopiedSub] = useState(false);
	const [copiedConfigIndex, setCopiedConfigIndex] = useState<number | null>(
		null,
	);
	const [configAnimIndex, setConfigAnimIndex] = useState<number | null>(null);
	const [subAnimSeed, setSubAnimSeed] = useState(0);
	const [configAnimSeed, setConfigAnimSeed] = useState(0);
	const { t } = useTranslation();
	const onClose = () => {
		setQRCode(null);
		setSubLink(null);
	};

	const subscribeQrLink = String(subscribeUrl).startsWith("/")
		? window.location.origin + subscribeUrl
		: String(subscribeUrl);

	const configItems = useMemo(() => {
		const links = QRcodeLinks ?? [];
		return links.map((link, itemIndex) => {
			const label =
				getConfigLabelFromLink(link) ||
				t("userDialog.links.configFallback", "Config {{index}}", {
					index: itemIndex + 1,
				});
			return { link, label };
		});
	}, [QRcodeLinks, t]);

	const activeIndex =
		configItems.length > 0 ? Math.min(index, configItems.length - 1) : 0;
	const activeConfigLabel = configItems[activeIndex]?.label ?? "";

	useEffect(() => {
		if (isOpen) {
			setIndex(0);
		}
	}, [isOpen]);

	useEffect(() => {
		if (index >= configItems.length && configItems.length > 0) {
			setIndex(0);
		}
	}, [index, configItems.length]);

	useEffect(() => {
		if (!isOpen) {
			setCopiedSub(false);
			setCopiedConfigIndex(null);
			setConfigAnimIndex(null);
		}
	}, [isOpen]);

	useEffect(() => {
		if (!copiedSub) return undefined;
		const timer = window.setTimeout(() => setCopiedSub(false), 1000);
		return () => window.clearTimeout(timer);
	}, [copiedSub]);

	useEffect(() => {
		if (copiedConfigIndex === null) return undefined;
		const timer = window.setTimeout(() => setCopiedConfigIndex(null), 1000);
		return () => window.clearTimeout(timer);
	}, [copiedConfigIndex]);

	return (
		<Modal isOpen={isOpen} onClose={onClose}>
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3" w="fit-content" maxW="3xl">
				<ModalHeader pt={6}>
					<Icon color="primary">
						<QRIcon color="white" />
					</Icon>
				</ModalHeader>
				<ModalCloseButton mt={3} />
				{QRcodeLinks && (
					<ModalBody
						gap={{
							base: "20px",
							lg: "50px",
						}}
						pr={{
							lg: "60px",
						}}
						px={{
							base: "50px",
						}}
						display="flex"
						justifyContent="center"
						flexDirection={{
							base: "column",
							lg: "row",
						}}
					>
						{subscribeUrl && (
							<VStack spacing={2}>
								<Text display="block" textAlign="center" fontWeight="semibold">
									{t("qrcodeDialog.sublink")}
								</Text>
								{copiedSub && (
									<Box
										bg="green.500"
										color="white"
										fontSize="xs"
										px={2}
										py={0.5}
										borderRadius="full"
									>
										{t("usersTable.copied")}
									</Box>
								)}
								<CopyToClipboard
									text={subscribeQrLink}
									onCopy={() => {
										setCopiedSub(true);
										setSubAnimSeed((prev) => prev + 1);
									}}
								>
									<Box
										key={`sub-qr-${subAnimSeed}`}
										cursor="pointer"
										role="button"
										aria-label={t("userDialog.links.copy", "Copy")}
										animation={
											copiedSub && subAnimSeed > 0
												? `${clickPulse} 260ms ease-in-out`
												: "none"
										}
									>
										<QRCode
											mx="auto"
											size={300}
											p="2"
											level={"L"}
											includeMargin={false}
											value={subscribeQrLink}
											bg="white"
										/>
									</Box>
								</CopyToClipboard>
							</VStack>
						)}
						{configItems.length > 0 && (
							<Box w="300px">
								<Text
									display="block"
									textAlign="center"
									fontWeight="semibold"
									mb={2}
								>
									{activeConfigLabel}
								</Text>
								{copiedConfigIndex === activeIndex && (
									<Box
										bg="green.500"
										color="white"
										fontSize="xs"
										px={2}
										py={0.5}
										borderRadius="full"
										mx="auto"
										mb={2}
										w="fit-content"
									>
										{t("usersTable.copied")}
									</Box>
								)}
								<SlickSlider
									centerPadding="0px"
									centerMode={true}
									slidesToShow={1}
									slidesToScroll={1}
									dots={false}
									afterChange={setIndex}
									onInit={() => setIndex(0)}
									nextArrow={
										<IconButton
											size="sm"
											position="absolute"
											display="flex !important"
											_before={{ content: '""' }}
											aria-label="next"
											mr="-4"
										>
											<NextIcon />
										</IconButton>
									}
									prevArrow={
										<IconButton
											size="sm"
											position="absolute"
											display="flex !important"
											_before={{ content: '""' }}
											aria-label="prev"
											ml="-4"
										>
											<PrevIcon />
										</IconButton>
									}
								>
									{configItems.map((item, itemIndex) => (
										<HStack key={`${item.link}-${itemIndex}`}>
											<CopyToClipboard
												text={item.link}
												onCopy={() => {
													setCopiedConfigIndex(itemIndex);
													setConfigAnimIndex(itemIndex);
													setConfigAnimSeed((prev) => prev + 1);
												}}
											>
												<Box
													key={
														configAnimIndex === itemIndex
															? `qr-${itemIndex}-${configAnimSeed}`
															: `qr-${itemIndex}`
													}
													cursor="pointer"
													role="button"
													aria-label={t("userDialog.links.copy", "Copy")}
													animation={
														configAnimIndex === itemIndex && configAnimSeed > 0
															? `${clickPulse} 260ms ease-in-out`
															: "none"
													}
												>
													<QRCode
														mx="auto"
														size={300}
														p="2"
														level={"L"}
														includeMargin={false}
														value={item.link}
														bg="white"
													/>
												</Box>
											</CopyToClipboard>
										</HStack>
									))}
								</SlickSlider>
								<Text display="block" textAlign="center" pb={3} mt={1}>
									{activeIndex + 1} / {configItems.length}
								</Text>
							</Box>
						)}
					</ModalBody>
				)}
			</ModalContent>
		</Modal>
	);
};
