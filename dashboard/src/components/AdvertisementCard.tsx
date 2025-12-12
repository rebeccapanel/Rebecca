import {
	Box,
	Image,
	Link,
	Stack,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import type { FC } from "react";

import type { AdItem } from "types/Ads";

type AdvertisementCardProps = {
	ad: AdItem;
	compact?: boolean;
	maxSize?: number;
};

export const AdvertisementCard: FC<AdvertisementCardProps> = ({
	ad,
	compact = false,
	maxSize,
}) => {
	const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
	const textColor = useColorModeValue("gray.600", "gray.300");
	const teaserColor = useColorModeValue("primary.600", "primary.200");
	const cardBackground = useColorModeValue("white", "gray.800");
	const paddingY = compact ? 2 : 3;
	const paddingX = compact ? 2 : 3;

	const isImageAd = ad.type === "image" || Boolean(ad.image_url);
	const maxSizePx = maxSize ?? 460;
	const isImageAdOnly = isImageAd && compact;
	const content = isImageAd ? (
		<Box
			w="100%"
			h="100%"
			display="flex"
			alignItems="center"
			justifyContent="center"
			overflow="hidden"
		>
			<Image
				alt={ad.title || ad.text || "Advertisement"}
				borderRadius={isImageAdOnly ? "lg" : "md"}
				objectFit={isImageAdOnly ? "cover" : "contain"}
				src={ad.image_url}
				maxH="100%"
				maxW="100%"
				h={isImageAdOnly ? "100%" : "auto"}
				w={isImageAdOnly ? "100%" : "auto"}
			/>
		</Box>
	) : (
		<Stack spacing={1}>
			{ad.title && (
				<Text fontSize={compact ? "sm" : "md"} fontWeight="semibold">
					{ad.title}
				</Text>
			)}
			{ad.text && (
				<Text
					fontSize={compact ? "xs" : "sm"}
					color={textColor}
					noOfLines={compact ? 3 : 4}
				>
					{ad.text}
				</Text>
			)}
		</Stack>
	);

	const body = (
		<Box
			borderColor={isImageAdOnly ? "transparent" : borderColor}
			borderWidth={isImageAdOnly ? "0" : "1px"}
			borderRadius="md"
			bg={isImageAdOnly ? "transparent" : cardBackground}
			px={isImageAdOnly ? 0 : paddingX}
			py={isImageAdOnly ? 0 : paddingY}
			w={isImageAdOnly ? "100%" : "full"}
			h={isImageAdOnly ? "100%" : "auto"}
			maxW={isImageAdOnly ? "100%" : `${maxSizePx}px`}
			maxH={isImageAdOnly ? "100%" : "none"}
			shadow={isImageAdOnly ? "none" : "sm"}
			transition="box-shadow 0.2s ease"
			display={isImageAdOnly ? "flex" : "block"}
			alignItems={isImageAdOnly ? "center" : "flex-start"}
			justifyContent={isImageAdOnly ? "center" : "flex-start"}
			overflow="hidden"
			_hover={{
				shadow: isImageAdOnly ? "none" : "md",
			}}
		>
			{content}
			{!isImageAd && ad.cta && (
				<Text
					fontSize={compact ? "xs" : "sm"}
					fontWeight="semibold"
					color={teaserColor}
					mt={ad.image_url ? 2 : 3}
				>
					{ad.cta}
				</Text>
			)}
		</Box>
	);

	if (ad.link) {
		return (
			<Link
				href={ad.link}
				isExternal
				display="block"
				_hover={{ textDecoration: "none" }}
			>
				{body}
			</Link>
		);
	}

	return body;
};
