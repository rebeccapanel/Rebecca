import {
  Box,
  Button,
  Flex,
  Grid,
  GridItem,
  HStack,
  IconButton,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Text,
  VStack,
  useDisclosure,
  useColorModeValue,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import { FC, useState, useEffect } from "react";

interface DateTimePickerProps {
  value?: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  quickSelects?: Array<{
    label: string;
    onClick: () => void;
  }>;
}

export const DateTimePicker: FC<DateTimePickerProps> = ({
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
  minDate,
  quickSelects = [],
}) => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [displayMonth, setDisplayMonth] = useState(() =>
    value ? dayjs(value) : dayjs()
  );
  const [selectedTime, setSelectedTime] = useState({
    hour: value ? dayjs(value).hour() : 12,
    minute: value ? dayjs(value).minute() : 0,
  });
  const popoverBg = useColorModeValue("white", "gray.900");
  const popoverText = useColorModeValue("gray.900", "white");
  const popoverBorderColor = useColorModeValue("gray.200", "gray.700");
  const quickSelectBg = useColorModeValue("gray.50", "gray.800");
  const quickSelectBorderColor = useColorModeValue("gray.100", "gray.700");
  const quickSelectHoverBg = useColorModeValue("gray.100", "gray.700");
  const dayNameColor = useColorModeValue("gray.500", "gray.400");
  const disabledDayColor = useColorModeValue("gray.400", "gray.500");
  const dayHoverBg = useColorModeValue("gray.100", "gray.700");
  const timeDividerColor = useColorModeValue("gray.200", "gray.700");
  const timeLabelColor = useColorModeValue("gray.600", "gray.400");
  const todayBorderColor = useColorModeValue("primary.500", "primary.400");

  useEffect(() => {
    if (value) {
      setDisplayMonth(dayjs(value));
      setSelectedTime({
        hour: dayjs(value).hour(),
        minute: dayjs(value).minute(),
      });
    }
  }, [value]);

  // Reset calendar to today when popover closes
  const handleClose = () => {
    if (!value) {
      setDisplayMonth(dayjs());
      setSelectedTime({
        hour: 12,
        minute: 0,
      });
    }
    onClose();
  };

  const daysInMonth = displayMonth.daysInMonth();
  const firstDayOfMonth = displayMonth.startOf("month").day();
  const today = dayjs();
  const selectedDay = value ? dayjs(value) : null;

  const handleDateSelect = (day: number) => {
    const newDate = displayMonth
      .date(day)
      .hour(selectedTime.hour)
      .minute(selectedTime.minute)
      .second(0)
      .millisecond(0);

    if (minDate && newDate.isBefore(dayjs(minDate), "day")) {
      return;
    }

    onChange(newDate.toDate());
  };

  const handleTimeChange = (hour: number, minute: number) => {
    setSelectedTime({ hour, minute });
    if (value) {
      const newDate = dayjs(value).hour(hour).minute(minute);
      onChange(newDate.toDate());
    }
  };

  const handleClear = () => {
    onChange(null);
    setDisplayMonth(dayjs());
    setSelectedTime({
      hour: 12,
      minute: 0,
    });
    onClose();
  };

  const prevMonth = () => setDisplayMonth(displayMonth.subtract(1, "month"));
  const nextMonth = () => setDisplayMonth(displayMonth.add(1, "month"));

  const handleQuickSelect = (days: number) => {
    const baseDate = value ? dayjs(value) : dayjs();
    const newDate = baseDate.add(days, "day");
    onChange(newDate.toDate());
    // Don't close the popover so user can click multiple times
  };

  const renderDays = () => {
    const days = [];
    const minDay = minDate ? dayjs(minDate) : null;

    // Empty cells for days before month starts
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<GridItem key={`empty-${i}`} />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = displayMonth.date(day);
      const isToday = currentDate.isSame(today, "day");
      const isSelected = selectedDay?.isSame(currentDate, "day");
      const isPast = minDay && currentDate.isBefore(minDay, "day");

      days.push(
        <GridItem key={day}>
          <Button
            size="xs"
            variant="ghost"
            w="full"
            h="28px"
            minW="28px"
            fontSize="xs"
            fontWeight={isToday ? "bold" : "normal"}
            bg={isSelected ? "primary.500" : "transparent"}
            color={isSelected ? "white" : isPast ? disabledDayColor : "inherit"}
            border={isToday ? "1px solid" : "none"}
            borderColor={todayBorderColor}
            _hover={{
              bg: isPast ? "transparent" : isSelected ? "primary.600" : dayHoverBg,
            }}
            onClick={() => !isPast && handleDateSelect(day)}
            isDisabled={!!isPast}
            cursor={isPast ? "not-allowed" : "pointer"}
          >
            {day}
          </Button>
        </GridItem>
      );
    }

    return days;
  };

  const displayValue = value
    ? dayjs(value).format("YYYY/MM/DD HH:mm")
    : "";

  return (
    <Popover
      isOpen={isOpen}
      onOpen={onOpen}
      onClose={handleClose}
      placement="bottom-start"
      isLazy
    >
      <PopoverTrigger>
        <Input
          value={displayValue}
          placeholder={placeholder}
          size="sm"
          isReadOnly
          cursor="pointer"
          isDisabled={disabled}
          onClick={onOpen}
          bg="transparent"
          _dark={{ bg: "transparent" }}
        />
      </PopoverTrigger>
      <Portal>
        <PopoverContent
          w="auto"
          maxW="min(90vw, 420px)"
          bg={popoverBg}
          borderColor={popoverBorderColor}
          color={popoverText}
          _focus={{ boxShadow: "none" }}
        >
          <PopoverBody p={0}>
          <Flex>
            {/* Quick Select Sidebar */}
            <VStack
              spacing={1}
              align="stretch"
              px={2}
              py={2}
              bg={quickSelectBg}
              minW="100px"
              maxW="110px"
              borderRight="1px solid"
              borderColor={quickSelectBorderColor}
              flexShrink={0}
            >
              {/* Built-in Quick Selects */}
              <Button
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                fontSize="xs"
                whiteSpace="nowrap"
                onClick={() => handleQuickSelect(1)}
                _hover={{ bg: quickSelectHoverBg }}
              >
                +1 Day
              </Button>
              <Button
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                fontSize="xs"
                whiteSpace="nowrap"
                onClick={() => handleQuickSelect(30)}
                _hover={{ bg: quickSelectHoverBg }}
              >
                +1 Month
              </Button>
              <Button
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                fontSize="xs"
                whiteSpace="nowrap"
                onClick={() => handleQuickSelect(90)}
                _hover={{ bg: quickSelectHoverBg }}
              >
                +3 Months
              </Button>
              <Button
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                fontSize="xs"
                whiteSpace="nowrap"
                onClick={() => handleQuickSelect(180)}
                _hover={{ bg: quickSelectHoverBg }}
              >
                +6 Months
              </Button>
              <Button
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                fontSize="xs"
                whiteSpace="nowrap"
                onClick={() => handleQuickSelect(365)}
                _hover={{ bg: quickSelectHoverBg }}
              >
                +1 Year
              </Button>
              <Button
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                fontSize="xs"
                whiteSpace="nowrap"
                onClick={() => handleQuickSelect(1095)}
                _hover={{ bg: quickSelectHoverBg }}
              >
                +3 Years
              </Button>
            </VStack>

            {/* Calendar */}
            <Box flex="1" p={2}>
              {/* Month Navigation */}
              <Flex justify="space-between" align="center" mb={2}>
                <HStack spacing={1}>
                  <IconButton
                    aria-label="Previous month"
                    size="xs"
                    variant="ghost"
                    icon={<ChevronLeftIcon width={14} height={14} />}
                    onClick={prevMonth}
                    _hover={{ bg: quickSelectHoverBg }}
                  />
                  <IconButton
                    aria-label="Next month"
                    size="xs"
                    variant="ghost"
                    icon={<ChevronRightIcon width={14} height={14} />}
                    onClick={nextMonth}
                    _hover={{ bg: quickSelectHoverBg }}
                  />
                </HStack>
                <Text fontSize="xs" fontWeight="semibold">
                  {displayMonth.format("MMMM YYYY")}
                </Text>
              </Flex>

              {/* Day Names */}
              <Grid templateColumns="repeat(7, 1fr)" gap={0.5} mb={1}>
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                  <GridItem key={day}>
                    <Text
                      fontSize="2xs"
                      textAlign="center"
                      color={dayNameColor}
                      fontWeight="semibold"
                    >
                      {day}
                    </Text>
                  </GridItem>
                ))}
              </Grid>

              {/* Days Grid */}
              <Grid templateColumns="repeat(7, 1fr)" gap={0.5} mb={2}>
                {renderDays()}
              </Grid>

              {/* Time Picker */}
              <HStack spacing={2} justify="center" pt={2} borderTop="1px solid" borderColor={timeDividerColor}>
                <Text fontSize="2xs" color={timeLabelColor}>
                  Time:
                </Text>
                <Input
                  type="number"
                  size="xs"
                  w="45px"
                  min={0}
                  max={23}
                  value={selectedTime.hour}
                  onChange={(e) => {
                    const h = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                    handleTimeChange(h, selectedTime.minute);
                  }}
                  textAlign="center"
                  fontSize="xs"
                />
                <Text fontSize="xs">:</Text>
                <Input
                  type="number"
                  size="xs"
                  w="45px"
                  min={0}
                  max={59}
                  value={selectedTime.minute}
                  onChange={(e) => {
                    const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                    handleTimeChange(selectedTime.hour, m);
                  }}
                  textAlign="center"
                  fontSize="xs"
                />
              </HStack>

              {/* Actions */}
              <HStack spacing={2} justify="flex-end" mt={2}>
                <Button size="xs" variant="ghost" onClick={handleClear}>
                  Clear
                </Button>
                <Button size="xs" colorScheme="primary" onClick={handleClose}>
                  Done
                </Button>
              </HStack>
            </Box>
          </Flex>
        </PopoverBody>
      </PopoverContent>
      </Portal>
    </Popover>
  );
};
