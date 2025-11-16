import {
  AspectRatio,
  Box,
  Image,
  Link,
  Stack,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { FC } from "react";

import { AdItem } from "types/Ads";

type AdvertisementCardProps = {
  ad: AdItem;
  compact?: boolean;
  ratio?: number;
  maxSize?: number;
};

export const AdvertisementCard: FC<AdvertisementCardProps> = ({
  ad,
  compact = false,
  ratio,
  maxSize,
}) => {
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
  const textColor = useColorModeValue("gray.600", "gray.300");
  const teaserColor = useColorModeValue("primary.600", "primary.200");
  const paddingY = compact ? 2 : 3;
  const paddingX = compact ? 2 : 3;

  const isImageAd = ad.type === "image" || Boolean(ad.image_url);
  const imageRatio = ratio ?? (compact ? 3 / 1 : 1);
  const maxSizePx = maxSize ?? 460;
  const content = isImageAd ? (
    <AspectRatio ratio={imageRatio} w="full">
      <Image
        alt={ad.title || ad.text || "Advertisement"}
        borderRadius="md"
        objectFit="contain"
        src={ad.image_url}
        w="100%"
        h="100%"
      />
    </AspectRatio>
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
      borderColor={borderColor}
      borderWidth="1px"
      borderRadius="md"
      bg={useColorModeValue("white", "gray.800")}
      px={paddingX}
      py={paddingY}
      w="full"
      maxW={`${maxSizePx}px`}
      shadow="sm"
      transition="box-shadow 0.2s ease"
      _hover={{
        shadow: "md",
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
