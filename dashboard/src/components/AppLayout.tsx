import {
  Box,
  HStack,
  IconButton,
  Flex,
  useBreakpointValue,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerBody,
  Button,
  Stack,
  Text,
  Divider,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Portal,
  useDisclosure,
} from "@chakra-ui/react";
import {
  ArrowLeftOnRectangleIcon,
  Bars3Icon,
  EllipsisVerticalIcon,
  LanguageIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";
import { AppSidebar } from "./AppSidebar";
import { GitHubStars } from "./GitHubStars";
import { Outlet, Link } from "react-router-dom";
import { useRef, useState } from "react";
import { useAppleEmoji } from "hooks/useAppleEmoji";
import { useTranslation } from "react-i18next";
import ReactCountryFlag from "react-country-flag";
import ThemeSelector from "./ThemeSelector";
import { ReactComponent as ImperialIranFlag } from "../assets/imperial-iran-flag.svg";

const iconProps = {
  baseStyle: {
    w: 4,
    h: 4,
  },
};

const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const MenuIcon = chakra(Bars3Icon, iconProps);
const MoreIcon = chakra(EllipsisVerticalIcon, iconProps);
const LanguageIconStyled = chakra(LanguageIcon, iconProps);

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useBreakpointValue({ base: true, md: false });
  const sidebarDrawer = useDisclosure();
  const actionsMenu = useDisclosure();
  const actionsContentRef = useRef<HTMLDivElement | null>(null);
  const { t, i18n } = useTranslation();
  useAppleEmoji();

  const languageItems = [
    { code: "en", label: "English", flag: "US" },
    { code: "fa", label: "پارسی", flag: "IR" },
    { code: "zh-cn", label: "中文", flag: "CN" },
    { code: "ru", label: "Русский", flag: "RU" },
  ];

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <Flex minH="100vh" maxH="100vh" overflow="hidden">
      {/* persistent sidebar on md+; drawer on mobile */}
      {!isMobile ? (
        <AppSidebar collapsed={sidebarCollapsed} onRequestExpand={() => setSidebarCollapsed(false)} />
      ) : null}

      <Flex 
        flex="1" 
        direction="column" 
        minW="0" 
        overflow="hidden"
        ml={isMobile ? "0" : sidebarCollapsed ? "16" : "60"}
        transition="margin-left 0.3s"
      >
        <Box
          as="header"
          h="16"
          minH="16"
          borderBottom="1px"
          borderColor="light-border"
          bg="surface.light"
          _dark={{ borderColor: "whiteAlpha.200", bg: "surface.dark" }}
          display="flex"
          alignItems="center"
          px="6"
          justifyContent="space-between"
          flexShrink={0}
        >
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="toggle sidebar"
            onClick={() => {
              if (isMobile) sidebarDrawer.onOpen();
              else setSidebarCollapsed(!sidebarCollapsed);
            }}
            icon={<MenuIcon />}
          />
          <HStack spacing={2}>
            <GitHubStars />
            <Popover
              isOpen={actionsMenu.isOpen}
              onOpen={actionsMenu.onOpen}
              onClose={actionsMenu.onClose}
              placement="bottom-end"
            >
              <PopoverTrigger>
                <IconButton
                  size="sm"
                  variant="outline"
                  icon={<MoreIcon />}
                  aria-label="quick actions"
                  onClick={() =>
                    actionsMenu.isOpen ? actionsMenu.onClose() : actionsMenu.onOpen()
                  }
                />
              </PopoverTrigger>
              <PopoverContent
                ref={actionsContentRef}
                w={"full"}
                maxW={{ base: "calc(100vw - 2rem)", sm: "56" }}
                mx={{ base: 4, sm: 0 }}
              >
                <PopoverArrow />
                <PopoverBody>
                  <Stack spacing={2}>
                      <Menu placement="left-start" isLazy>
                        <MenuButton
                          as={Button}
                          justifyContent="space-between"
                          rightIcon={<LanguageIconStyled />}
                          variant="ghost"
                        >
                          {t("header.language", "Language")}
                        </MenuButton>
                        <Portal containerRef={actionsContentRef}>
                          <MenuList
                            minW={{ base: "100%", sm: "200px" }}
                            maxW={{ base: "100%", sm: "240px" }}
                            maxH="60vh"
                            overflowY="auto"
                          >
                            {languageItems.map(({ code, label, flag }) => {
                              const isActiveLang = i18n.language === code;
                              return (
                                <MenuItem
                                  key={code}
                                  onClick={() => {
                                    changeLanguage(code);
                                    actionsMenu.onClose();
                                  }}
                                >
                                  <HStack justify="space-between" w="full">
                                    <HStack spacing={2}>
                                      {code === "fa" ? (
                                        <ImperialIranFlag style={{ width: "16px", height: "12px" }} />
                                      ) : (
                                        <ReactCountryFlag
                                          countryCode={flag}
                                          svg
                                          style={{ width: "16px", height: "12px" }}
                                        />
                                      )}
                                      <Text>{label}</Text>
                                    </HStack>
                                    {isActiveLang && <CheckIcon width={16} />}
                                  </HStack>
                                </MenuItem>
                              );
                            })}
                          </MenuList>
                        </Portal>
                      </Menu>
                    <Divider />
                      <ThemeSelector
                        trigger="menu"
                        triggerLabel={t("header.theme", "Theme")}
                        portalContainer={actionsContentRef}
                      />
                    <Divider />
                    <Button
                      colorScheme="red"
                      leftIcon={<LogoutIcon />}
                      justifyContent="flex-start"
                      as={Link}
                      to="/login"
                      onClick={actionsMenu.onClose}
                    >
                      {t("header.logout", "Log out")}
                    </Button>
                  </Stack>
                </PopoverBody>
              </PopoverContent>
            </Popover>
          </HStack>
        </Box>
        <Box as="main" flex="1" p="6" overflow="auto" minH="0">
          <Outlet />
        </Box>
      </Flex>

        {/* mobile drawer */}
        {isMobile && (
          <Drawer isOpen={sidebarDrawer.isOpen} placement="left" onClose={sidebarDrawer.onClose} size="xs">
            <DrawerOverlay />
            <DrawerContent bg="surface.light" _dark={{ bg: "surface.dark" }}>
              <DrawerBody p={0}>
                <AppSidebar collapsed={false} inDrawer onRequestExpand={sidebarDrawer.onClose} />
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        )}
    </Flex>
  );
}

