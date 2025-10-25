import { Box, VStack, HStack, Text, chakra, Collapse } from "@chakra-ui/react";
import {
  HomeIcon,
  UsersIcon,
  ServerIcon,
  Cog6ToothIcon,
  ChartBarIcon,
  Square3Stack3DIcon,
  ShieldCheckIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ElementType, FC, useEffect, useState } from "react";
import useGetUser from "hooks/useGetUser";

const iconProps = {
  baseStyle: {
    w: 5,
    h: 5,
  },
};

const HomeIconStyled = chakra(HomeIcon, iconProps);
const UsersIconStyled = chakra(UsersIcon, iconProps);
const ServerIconStyled = chakra(ServerIcon, iconProps);
const SettingsIconStyled = chakra(Cog6ToothIcon, iconProps);
const ChartIconStyled = chakra(ChartBarIcon, iconProps);
const NetworkIconStyled = chakra(Square3Stack3DIcon, iconProps);
const AdminIconStyled = chakra(ShieldCheckIcon, iconProps);
const ChevronDownIconStyled = chakra(ChevronDownIcon, iconProps);

interface AppSidebarProps {
  collapsed: boolean;
  /** when rendered inside a Drawer on mobile */
  inDrawer?: boolean;
}

type SidebarItem = {
  title: string;
  icon: ElementType;
  url?: string;
  subItems?: { title: string; url: string; icon: ElementType }[];
};

export const AppSidebar: FC<AppSidebarProps> = ({ collapsed, inDrawer = false }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { userData, getUserIsSuccess } = useGetUser();
  const isSudo = getUserIsSuccess && userData.is_sudo;
  const settingsSubItems: SidebarItem["subItems"] = [
    { title: t("header.hostSettings"), url: "/hosts", icon: ServerIconStyled },
    { title: t("header.nodeSettings"), url: "/node-settings", icon: NetworkIconStyled },
    { title: t("header.xraySettings"), url: "/xray-settings", icon: SettingsIconStyled },
  ];
  const isSettingsRoute = settingsSubItems.some((sub) => location.pathname === sub.url);
  const [isSettingsOpen, setSettingsOpen] = useState(isSettingsRoute);

  useEffect(() => {
    if (isSettingsRoute) {
      setSettingsOpen(true);
    }
  }, [isSettingsRoute]);

  const items: SidebarItem[] = [
    { title: t("dashboard"), url: "/", icon: HomeIconStyled },
    { title: t("users"), url: "/users", icon: UsersIconStyled },
    ...(isSudo
      ? [
          { title: t("admins", "Admins"), url: "/admins", icon: AdminIconStyled },
          {
            title: t("header.settings"),
            icon: SettingsIconStyled,
            subItems: settingsSubItems,
          },
        ]
      : []),
  ];

  return (
    <Box
      w={inDrawer ? "full" : collapsed ? "16" : "60"}
      h={inDrawer ? "100%" : "100vh"}
      maxH={inDrawer ? "100%" : "100vh"}
      bg="surface.light"
      borderRight={inDrawer ? undefined : "1px"}
      borderColor={inDrawer ? undefined : "light-border"}
      _dark={{ bg: "surface.dark", borderColor: inDrawer ? undefined : "whiteAlpha.200" }}
      transition="width 0.3s"
      position={inDrawer ? "relative" : "fixed"}
      top={inDrawer ? undefined : "0"}
      left={inDrawer ? undefined : "0"}
      overflowY="auto"
      overflowX="hidden"
      flexShrink={0}
    >
      <VStack spacing={1} p={4} align="stretch">
        {!collapsed && (
          <Text
            fontSize="xs"
            fontWeight="bold"
            color="gray.500"
            _dark={{ color: "gray.400" }}
            px={2}
            mb={2}
          >
            {t("menu")}
          </Text>
        )}
        {items.map((item) => {
          const itemUrl = item.url;
          const isActive =
            (typeof itemUrl === "string" && location.pathname === itemUrl) ||
            (typeof itemUrl === "string" &&
              itemUrl !== "/" &&
              location.pathname.startsWith(itemUrl)) ||
            (item.subItems && item.subItems.some((sub) => location.pathname === sub.url));
          const Icon = item.icon;

          return (
            <Box key={item.title}>
              {item.subItems ? (
                <>
                  <HStack
                    spacing={3}
                    px={3}
                    py={2}
                    borderRadius="md"
                    cursor="pointer"
                    bg={isActive ? "primary.50" : "transparent"}
                    color={isActive ? "primary.600" : "gray.700"}
                    _dark={{
                      bg: isActive ? "primary.900" : "transparent",
                      color: isActive ? "primary.200" : "gray.300",
                    }}
                    _hover={{
                      bg: isActive ? "primary.50" : "gray.50",
                      _dark: {
                        bg: isActive ? "primary.900" : "gray.700",
                      },
                    }}
                    transition="all 0.2s"
                    justifyContent={collapsed ? "center" : "space-between"}
                    onClick={() => setSettingsOpen(!isSettingsOpen)}
                  >
                    <HStack>
                      <Icon />
                      {!collapsed && (
                        <Text fontSize="sm" fontWeight={isActive ? "semibold" : "normal"}>
                          {item.title}
                        </Text>
                      )}
                    </HStack>
                    {!collapsed && <ChevronDownIconStyled transform={isSettingsOpen ? "rotate(180deg)" : "rotate(0deg)"} />}
                  </HStack>
                  {!collapsed && (
                    <Collapse in={isSettingsOpen} animateOpacity>
                      <VStack align="stretch" pl={6}>
                        {item.subItems.map((subItem) => {
                          const isSubActive = location.pathname === subItem.url;
                          const SubIcon = subItem.icon;
                          return (
                            <NavLink key={subItem.url} to={subItem.url}>
                              <HStack
                                spacing={3}
                                px={3}
                                py={2}
                                borderRadius="md"
                                cursor="pointer"
                                bg={isSubActive ? "primary.50" : "transparent"}
                                color={isSubActive ? "primary.600" : "gray.700"}
                                _dark={{
                                  bg: isSubActive ? "primary.900" : "transparent",
                                  color: isSubActive ? "primary.200" : "gray.300",
                                }}
                                _hover={{
                                  bg: isSubActive ? "primary.50" : "gray.50",
                                  _dark: {
                                    bg: isSubActive ? "primary.900" : "gray.700",
                                  },
                                }}
                                transition="all 0.2s"
                              >
                                <SubIcon />
                                <Text fontSize="sm" fontWeight={isSubActive ? "semibold" : "normal"}>
                                  {subItem.title}
                                </Text>
                              </HStack>
                            </NavLink>
                          );
                        })}
                      </VStack>
                    </Collapse>
                  )}
                </>
              ) : (
                item.url ? (
                  <NavLink to={item.url}>
                  <HStack
                    spacing={3}
                    px={3}
                    py={2}
                    borderRadius="md"
                    cursor="pointer"
                    bg={isActive ? "primary.50" : "transparent"}
                    color={isActive ? "primary.600" : "gray.700"}
                    _dark={{
                      bg: isActive ? "primary.900" : "transparent",
                      color: isActive ? "primary.200" : "gray.300",
                    }}
                    _hover={{
                      bg: isActive ? "primary.50" : "gray.50",
                      _dark: {
                        bg: isActive ? "primary.900" : "gray.700",
                      },
                    }}
                    transition="all 0.2s"
                    justifyContent={collapsed ? "center" : "flex-start"}
                  >
                    <Icon />
                    {!collapsed && (
                      <Text fontSize="sm" fontWeight={isActive ? "semibold" : "normal"}>
                        {item.title}
                      </Text>
                    )}
                  </HStack>
                  </NavLink>
                ) : null
              )}
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
};
