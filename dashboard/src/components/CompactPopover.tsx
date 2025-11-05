import React from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  PopoverCloseButton,
  PopoverHeader,
  Button,
  Tag,
  VStack,
  HStack,
  Text,
  IconButton,
  useClipboard,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ClipboardIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";

const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });
const CopyIcon = chakra(ClipboardIcon, { baseStyle: { w: 4, h: 4 } });

interface CompactPopoverProps {
  triggerLabel?: React.ReactNode;
  title?: React.ReactNode;
  children: React.ReactNode;
}

export const CompactPopover: React.FC<CompactPopoverProps> = ({ triggerLabel, title, children }) => {
  const isMobile = useBreakpointValue({ base: true, md: false });
  return (
    <Popover placement={isMobile ? "bottom" : "right"} isLazy>
      <PopoverTrigger>
        <Button size="xs" variant="outline">
          {triggerLabel ?? <InfoIcon />}
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverArrow />
        <PopoverCloseButton />
        {title && <PopoverHeader fontWeight="semibold">{title}</PopoverHeader>}
        <PopoverBody>
          {children}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
};

export const CompactChips: React.FC<{ chips: string[]; color?: string }> = ({ chips, color = "blue" }) => {
  const first = chips[0];
  const rest = chips.slice(1);
  return (
    <HStack spacing={2} align="center">
      {first ? <Tag size="sm" colorScheme={color}>{first}</Tag> : <Text color="gray.400">-</Text>}
      {rest.length > 0 && (
        <CompactPopover triggerLabel={<Tag size="sm">+{rest.length}</Tag>} title={"Details"}>
          <VStack align="stretch">
            {chips.map((c, i) => (
              <HStack key={i} justify="space-between">
                <Text>{c}</Text>
              </HStack>
            ))}
          </VStack>
        </CompactPopover>
      )}
    </HStack>
  );
};

export const CompactTextWithCopy: React.FC<{ text?: string; label?: string }> = ({ text, label }) => {
  const display = text && text.length > 40 ? `${text.slice(0, 36)}...` : text || "-";
  const { hasCopied, onCopy } = useClipboard(text ?? "");
  return (
    <HStack spacing={2} align="center">
      <CompactPopover triggerLabel={display} title={label}>
        <VStack align="stretch">
          <Text wordBreak="break-all">{text}</Text>
          <HStack>
            <IconButton aria-label="copy" size="sm" icon={<CopyIcon />} onClick={onCopy} />
            <Text fontSize="sm">{hasCopied ? "Copied" : "Copy"}</Text>
          </HStack>
        </VStack>
      </CompactPopover>
    </HStack>
  );
};

export default CompactPopover;
