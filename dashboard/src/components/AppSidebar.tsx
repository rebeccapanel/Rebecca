import { Box, VStack, HStack, Text, chakra, Collapse, useColorMode, Tooltip } from "@chakra-ui/react";
import {
  HomeIcon,
  UsersIcon,
  ServerIcon,
  Cog6ToothIcon,
  Square3Stack3DIcon,
  ShieldCheckIcon,
  ChevronDownIcon,
  Squares2X2Icon,
  ChartPieIcon,
} from "@heroicons/react/24/outline";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ElementType, FC, useEffect, useMemo, useState } from "react";
import useGetUser from "hooks/useGetUser";
import logoUrl from "assets/logo.svg";

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
const NetworkIconStyled = chakra(Square3Stack3DIcon, iconProps);
const AdminIconStyled = chakra(ShieldCheckIcon, iconProps);
const ChevronDownIconStyled = chakra(ChevronDownIcon, iconProps);
const ServicesIconStyled = chakra(Squares2X2Icon, iconProps);
const UsageIconStyled = chakra(ChartPieIcon, iconProps);
interface AppSidebarProps {
  collapsed: boolean;
  /** when rendered inside a Drawer on mobile */
  inDrawer?: boolean;
  /** optional callback to request the parent to expand the sidebar */
  onRequestExpand?: () => void;
}

type SidebarItem = {
  title: string;
  icon: ElementType;
  url?: string;
  subItems?: { title: string; url: string; icon: ElementType }[];
};
type SidebarSubItems = NonNullable<SidebarItem["subItems"]>;

const LogoIcon = chakra("img", {
  baseStyle: {
    w: 8,
    h: 8,
  },
});

export const AppSidebar: FC<AppSidebarProps> = ({ collapsed, inDrawer = false, onRequestExpand }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { colorMode } = useColorMode();
  const { userData, getUserIsSuccess } = useGetUser();
  const roleLabel = useMemo(() => {
    switch (userData.role) {
      case "full_access":
        return t("admins.roles.fullAccess", "Full access");
      case "sudo":
        return t("admins.roles.sudo", "Sudo");
      case "standard":
      default:
        return t("admins.roles.standard", "Standard");
    }
  }, [t, userData.role]);
  const sectionAccess = userData.permissions?.sections;
  const canViewUsage = Boolean(sectionAccess?.usage);
  const canViewAdmins = Boolean(sectionAccess?.admins);
  const canViewServicesSection = Boolean(sectionAccess?.services);

  const baseSettingsSubItems: SidebarSubItems = [
    sectionAccess?.hosts
      ? { title: t("header.hostSettings"), url: "/hosts", icon: ServerIconStyled }
      : null,
    sectionAccess?.nodes
      ? { title: t("header.nodeSettings"), url: "/node-settings", icon: NetworkIconStyled }
      : null,
    sectionAccess?.integrations
      ? {
          title: t("header.integrationSettings", "Master Settings"),
          url: "/integrations",
          icon: SettingsIconStyled,
        }
      : null,
    sectionAccess?.xray
      ? { title: t("header.xraySettings"), url: "/xray-settings", icon: SettingsIconStyled }
      : null,
  ].filter(Boolean) as SidebarSubItems;

  const settingsSubItems: SidebarSubItems = [...baseSettingsSubItems];

  if (canViewServicesSection) {
    settingsSubItems.unshift({
      title: t("services.menu", "Services"),
      url: "/services",
      icon: ServicesIconStyled,
    });
  }

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
  ];

  if (canViewUsage) {
    items.push({ title: t("usage.menu", "Usage"), url: "/usage", icon: UsageIconStyled });
  }
  if (canViewAdmins) {
    items.push({ title: t("admins", "Admins"), url: "/admins", icon: AdminIconStyled });
  }
  if (settingsSubItems.length > 0) {
    items.push({
      title: t("header.settings"),
      icon: SettingsIconStyled,
      subItems: settingsSubItems,
    });
  }

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
      <VStack spacing={2} p={collapsed ? 2 : 4} align="stretch" h="100%" justify="space-between">
        <Box flex="1" overflowY="auto">
          {!collapsed ? (
            <HStack spacing={3} align="center" mb={6} px={2}>
              <LogoIcon
                src={logoUrl}
                alt="Rebecca"
                filter={colorMode === "dark" ? "brightness(0) invert(1)" : "none"}
              />
              <Text
                fontSize="lg"
                fontWeight="bold"
                color="primary.600"
                _dark={{ color: "primary.300" }}
              >
                {t("menu")}
              </Text>
            </HStack>
          ) : (
            <HStack justify="center" mb={6}>
              <Tooltip label="Rebecca" placement="right" hasArrow>
                <LogoIcon
                  src={logoUrl}
                  alt="Rebecca"
                  filter={colorMode === "dark" ? "brightness(0) invert(1)" : "none"}
                />
              </Tooltip>
            </HStack>
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
                  <Tooltip label={collapsed ? item.title : ""} placement="right" hasArrow>
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
                      onClick={() => {
                        if (collapsed) {
                          // request parent to expand the sidebar and open settings
                          onRequestExpand && onRequestExpand();
                          setSettingsOpen(true);
                        } else {
                          setSettingsOpen(!isSettingsOpen);
                        }
                      }}
                    >
                      <HStack spacing={3}>
                        <Icon w={collapsed ? 5 : undefined} h={collapsed ? 5 : undefined} />
                        {!collapsed && (
                          <Text fontSize="sm" fontWeight={isActive ? "semibold" : "normal"}>
                            {item.title}
                          </Text>
                        )}
                      </HStack>
                      {!collapsed && <ChevronDownIconStyled transform={isSettingsOpen ? "rotate(180deg)" : "rotate(0deg)"} />}
                    </HStack>
                  </Tooltip>
                  {!collapsed && (
                    <Collapse in={isSettingsOpen} animateOpacity>
                      <VStack align="stretch" pl={6} spacing={1} mt={2}>
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
                                <SubIcon w={collapsed ? 5 : undefined} h={collapsed ? 5 : undefined} />
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
                    <Tooltip label={collapsed ? item.title : ""} placement="right" hasArrow>
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
                        <Icon w={collapsed ? 5 : undefined} h={collapsed ? 5 : undefined} />
                        {!collapsed && (
                          <Text fontSize="sm" fontWeight={isActive ? "semibold" : "normal"}>
                            {item.title}
                          </Text>
                        )}
                      </HStack>
                    </Tooltip>
                  </NavLink>
                ) : null
              )}
            </Box>
          );
        })}
        </Box>
        {getUserIsSuccess && userData.username && (
          <Box
            px={collapsed ? 2 : 3}
            py={2}
            borderTop="1px"
            borderColor="light-border"
            _dark={{ borderColor: "whiteAlpha.200" }}
            mt={4}
          >
            {!collapsed ? (
              <VStack align="flex-start" spacing={1}>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  _dark={{ color: "gray.500" }}
                >
                  username:
                </Text>
                <Text
                  fontSize="sm"
                  fontWeight="medium"
                  color="gray.700"
                  _dark={{ color: "gray.300" }}
                  noOfLines={1}
                >
                  {userData.username}
                </Text>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  _dark={{ color: "gray.500" }}
                >
                  {t("admins.roleLabel", "Admin role")}
                </Text>
                <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
                  {roleLabel}
                </Text>
              </VStack>
            ) : (
              <Tooltip label={`${userData.username} · ${roleLabel}`} placement="right" hasArrow>
                <Box
                  w="8"
                  h="8"
                  borderRadius="full"
                  bg="primary.100"
                  _dark={{ bg: "primary.800" }}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  mx="auto"
                  flexShrink={0}
                >
                  <Text
                    fontSize="sm"
                    fontWeight="bold"
                    color="primary.600"
                    _dark={{ color: "primary.300" }}
                    textAlign="center"
                  >
                    {userData.username.charAt(0).toUpperCase()}
                  </Text>
                </Box>
              </Tooltip>
            )}
          </Box>
        )}
      </VStack>
    </Box>
  );
};



