import {
  Box,
  HStack,
  IconButton,
  useColorMode,
  Flex,
  useBreakpointValue,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerBody,
  useDisclosure,
} from "@chakra-ui/react";
import { MoonIcon, SunIcon, ArrowLeftOnRectangleIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";
import { AppSidebar } from "./AppSidebar";
import { Language } from "./Language";
import { Outlet, Link } from "react-router-dom";
import { updateThemeColor } from "utils/themeColor";
import { useState } from "react";

const iconProps = {
  baseStyle: {
    w: 4,
    h: 4,
  },
};

const DarkIcon = chakra(MoonIcon, iconProps);
const LightIcon = chakra(SunIcon, iconProps);
const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const MenuIcon = chakra(Bars3Icon, iconProps);

export function AppLayout() {
  const { colorMode, toggleColorMode } = useColorMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useBreakpointValue({ base: true, md: false });
  const drawer = useDisclosure();

  return (
    <Flex minH="100vh" maxH="100vh" overflow="hidden">
      {/* persistent sidebar on md+; drawer on mobile */}
      {!isMobile ? (
        <AppSidebar collapsed={sidebarCollapsed} />
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
          _dark={{ borderColor: "gray.600" }}
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
              if (isMobile) drawer.onOpen();
              else setSidebarCollapsed(!sidebarCollapsed);
            }}
            icon={<MenuIcon />}
          />
          <HStack spacing={2}>
            <Language />
            <IconButton
              size="sm"
              variant="outline"
              aria-label="switch theme"
              onClick={() => {
                updateThemeColor(colorMode == "dark" ? "light" : "dark");
                toggleColorMode();
              }}
            >
              {colorMode === "light" ? <DarkIcon /> : <LightIcon />}
            </IconButton>
            <Link to="/login">
              <IconButton
                size="sm"
                variant="outline"
                aria-label="logout"
                icon={<LogoutIcon />}
              />
            </Link>
          </HStack>
        </Box>
        <Box as="main" flex="1" p="6" overflow="auto" minH="0">
          <Outlet />
        </Box>
      </Flex>

        {/* mobile drawer */}
        {isMobile && (
          <Drawer isOpen={drawer.isOpen} placement="left" onClose={drawer.onClose} size="xs">
            <DrawerOverlay />
            <DrawerContent>
              <DrawerBody p={0}>
                <AppSidebar collapsed={false} inDrawer />
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        )}
    </Flex>
  );
}
