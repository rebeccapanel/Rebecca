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
  useDisclosure,
} from "@chakra-ui/react";
import { ArrowLeftOnRectangleIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";
import { AppSidebar } from "./AppSidebar";
import { Language } from "./Language";
import ThemeSelector from "./ThemeSelector";
import { Outlet, Link } from "react-router-dom";
import { useState } from "react";
import { useAppleEmoji } from "hooks/useAppleEmoji";

const iconProps = {
  baseStyle: {
    w: 4,
    h: 4,
  },
};

const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const MenuIcon = chakra(Bars3Icon, iconProps);

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useBreakpointValue({ base: true, md: false });
  const drawer = useDisclosure();
  useAppleEmoji();

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
              if (isMobile) drawer.onOpen();
              else setSidebarCollapsed(!sidebarCollapsed);
            }}
            icon={<MenuIcon />}
          />
          <HStack spacing={2}>
            <Language />
            <ThemeSelector />
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
            <DrawerContent bg="surface.light" _dark={{ bg: "surface.dark" }}>
              <DrawerBody p={0}>
                <AppSidebar collapsed={false} inDrawer />
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        )}
    </Flex>
  );
}
