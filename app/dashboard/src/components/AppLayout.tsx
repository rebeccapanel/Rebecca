import { Box, HStack, IconButton, useColorMode, Flex } from "@chakra-ui/react";
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

  return (
    <Flex minH="100vh">
      <AppSidebar collapsed={sidebarCollapsed} />
      <Flex flex="1" direction="column">
        <Box
          as="header"
          h="16"
          borderBottom="1px"
          borderColor="light-border"
          _dark={{ borderColor: "gray.600" }}
          display="flex"
          alignItems="center"
          px="6"
          justifyContent="space-between"
        >
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="toggle sidebar"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
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
        <Box as="main" flex="1" p="6" overflow="auto">
          <Outlet />
        </Box>
      </Flex>
    </Flex>
  );
}
