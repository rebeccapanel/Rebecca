import {
  Box,
  BoxProps,
  Text,
  VStack,
  useColorModeValue,
} from "@chakra-ui/react";
import { FC, ReactNode } from "react";

export type ChartBoxProps = BoxProps & {
  title?: string;
  children: ReactNode;
  headerActions?: ReactNode;
};

export const ChartBox: FC<ChartBoxProps> = ({
  title,
  children,
  headerActions,
  ...props
}) => {
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.300");
  const bg = useColorModeValue("white", "blackAlpha.400");
  const shadow = useColorModeValue("sm", "none");

  return (
    <Box
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      bg={bg}
      boxShadow={shadow}
      overflow="hidden"
      {...props}
    >
      {(title || headerActions) && (
        <Box
          px={{ base: 3, md: 4 }}
          py={3}
          borderBottomWidth="1px"
          borderBottomColor={borderColor}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          {title && (
            <Text fontWeight="semibold" fontSize={{ base: "sm", md: "md" }}>
              {title}
            </Text>
          )}
          {headerActions && <Box>{headerActions}</Box>}
        </Box>
      )}
      <Box p={{ base: 3, md: 4 }}>{children}</Box>
    </Box>
  );
};

