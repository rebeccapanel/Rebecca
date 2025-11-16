import {
  Box,
  chakra,
  HStack,
  IconButton,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  useColorMode,
  useBreakpointValue,
  MenuDivider,
} from "@chakra-ui/react";
import {
  ArrowLeftOnRectangleIcon,
  Bars3Icon,
  Cog6ToothIcon,
  DocumentMinusIcon,
  LinkIcon,
  MoonIcon,
  SquaresPlusIcon,
  SunIcon,
  EllipsisVerticalIcon,
  LanguageIcon,
  SwatchIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
import { FC, ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { updateThemeColor } from "utils/themeColor";
import { Language } from "./Language";
import ThemeSelector from "./ThemeSelector";
import { GitHubStars } from "./GitHubStars";
import useGetUser from "hooks/useGetUser";
import useAds from "hooks/useAds";
import { AdvertisementCard } from "./AdvertisementCard";
import { pickLocalizedAd } from "utils/ads";
import ReactCountryFlag from "react-country-flag";
import { AdminRole, AdminSection, UserPermissionToggle } from "types/Admin";

type HeaderProps = {
  actions?: ReactNode;
};
const iconProps = {
  baseStyle: {
    w: 4,
    h: 4,
  },
};

const DarkIcon = chakra(MoonIcon, iconProps);
const LightIcon = chakra(SunIcon, iconProps);
const CoreSettingsIcon = chakra(Cog6ToothIcon, iconProps);
const SettingsIcon = chakra(Bars3Icon, iconProps);
const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const HostsIcon = chakra(LinkIcon, iconProps);
const NodesIcon = chakra(SquaresPlusIcon, iconProps);
const ResetUsageIcon = chakra(DocumentMinusIcon, iconProps);
const MoreIcon = chakra(EllipsisVerticalIcon, iconProps);
const LanguageIconStyled = chakra(LanguageIcon, iconProps);
const ThemeIconStyled = chakra(SwatchIcon, iconProps);

export const Header: FC<HeaderProps> = ({ actions }) => {
  const { userData, getUserIsSuccess, getUserIsPending } = useGetUser();
  const shouldShowAds =
    getUserIsSuccess &&
    [AdminRole.Sudo, AdminRole.FullAccess].includes(userData.role);
  const { data: adsData } = useAds(shouldShowAds);
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language || "en";
  const headerAd = shouldShowAds ? pickLocalizedAd(adsData, "header", currentLanguage) : undefined;

  const sectionAccess = userData.permissions?.sections;
  const canAccessHosts = Boolean(sectionAccess?.[AdminSection.Hosts]);
  const canAccessNodes = Boolean(sectionAccess?.[AdminSection.Nodes]);
  const canResetAllUsage = Boolean(
    userData.permissions?.users?.[UserPermissionToggle.ResetUsage]
  );
  const canOpenCoreSettings = Boolean(
    sectionAccess?.[AdminSection.Integrations] || sectionAccess?.[AdminSection.Xray]
  );
  const hasSettingsActions = canAccessHosts || canAccessNodes || canResetAllUsage;

  const { onResetAllUsage, onEditingNodes } = useDashboard();
  const { colorMode, toggleColorMode } = useColorMode();
  
  const isMobile = useBreakpointValue({ base: true, md: false });

  const languageItems = [
    { code: "en", label: "English", flag: "US" },
    { code: "fa", label: "فارسی", flag: "IR" },
    { code: "zh-cn", label: "中文", flag: "CN" },
    { code: "ru", label: "Русский", flag: "RU" },
  ];

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <HStack
      gap={2}
      justifyContent="space-between"
      __css={{
        "& .menuList": {
          direction: "ltr",
        },
      }}
      position="relative"
    >
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("users")}
      </Text>
      <Box overflow="auto" css={{ direction: "rtl" }}>
          <HStack alignItems="center" spacing={3}>
            {headerAd && (
              <Box
                flexShrink={0}
                h={{ base: "40px", md: "60px" }}
                w={{ base: "120px", md: "180px" }}
              >
                <AdvertisementCard ad={headerAd} compact ratio={3 / 1} maxSize={460} />
              </Box>
            )}
          <Menu>
            <MenuButton
              as={IconButton}
              size="sm"
              variant="outline"
              icon={
                <>
                  <SettingsIcon />
                </>
              }
              position="relative"
            ></MenuButton>
            <MenuList minW="170px" zIndex={99999} className="menuList">
              {hasSettingsActions && (
                <>
                  {canAccessHosts && (
                    <MenuItem
                      maxW="170px"
                      fontSize="sm"
                      icon={<HostsIcon />}
                      as={Link}
                      to="/hosts"
                    >
                      {t("header.hostSettings")}
                    </MenuItem>
                  )}
                  {canAccessNodes && (
                    <MenuItem
                      maxW="170px"
                      fontSize="sm"
                      icon={<NodesIcon />}
                      onClick={onEditingNodes.bind(null, true)}
                    >
                      {t("header.nodeSettings")}
                    </MenuItem>
                  )}
                  {canResetAllUsage && (
                    <MenuItem
                      maxW="170px"
                      fontSize="sm"
                      icon={<ResetUsageIcon />}
                      onClick={onResetAllUsage.bind(null, true)}
                    >
                      {t("resetAllUsage")}
                    </MenuItem>
                  )}
                  {!isMobile && (
                    <MenuItem maxW="170px" fontSize="sm" icon={<LogoutIcon />} as={Link} to="/login">
                      {t("header.logout")}
                    </MenuItem>
                  )}
                </>
              )}
              {!hasSettingsActions && !isMobile && (
                <Link to="/login">
                  <MenuItem maxW="170px" fontSize="sm" icon={<LogoutIcon />}>
                    {t("header.logout")}
                  </MenuItem>
                </Link>
              )}
            </MenuList>
          </Menu>

          {(canOpenCoreSettings || canAccessHosts || canAccessNodes) && (
            <IconButton
              size="sm"
              variant="outline"
              aria-label="core settings"
              onClick={() => {
                useDashboard.setState({ isEditingCore: true });
              }}
            >
              <CoreSettingsIcon />
            </IconButton>
          )}

          <GitHubStars />

          {/* Desktop: Show individual buttons */}
          {!isMobile && (
            <>
              <Language />
              <ThemeSelector />
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
            </>
          )}

          {/* Mobile: Show menu with all options */}
          {isMobile && (
            <Menu>
              <MenuButton
                as={IconButton}
                size="sm"
                variant="outline"
                icon={<MoreIcon />}
                aria-label="more options"
              />
              <MenuList minW="170px" zIndex={99999} className="menuList">
                {/* Language submenu */}
                <Menu placement="left-start">
                  <MenuButton
                    as={MenuItem}
                    fontSize="sm"
                    icon={<LanguageIconStyled />}
                  >
                    {t("header.language", "Language")}
                  </MenuButton>
                  <MenuList minW="160px" zIndex={99999}>
                    {languageItems.map(({ code, label, flag }) => (
                      <MenuItem
                        key={code}
                        fontSize="sm"
                        onClick={() => changeLanguage(code)}
                      >
                        <HStack justify="space-between" w="full">
                          <HStack spacing={2}>
                            <ReactCountryFlag 
                              countryCode={flag} 
                              svg 
                              style={{ width: "16px", height: "12px" }} 
                            />
                            <Text>{label}</Text>
                          </HStack>
                          {i18n.language === code && <CheckIcon width={16} />}
                        </HStack>
                      </MenuItem>
                    ))}
                  </MenuList>
                </Menu>

                {/* Theme Mode Toggle */}
                <MenuItem
                  fontSize="sm"
                  icon={colorMode === "light" ? <DarkIcon /> : <LightIcon />}
                  onClick={() => {
                    updateThemeColor(colorMode == "dark" ? "light" : "dark");
                    toggleColorMode();
                  }}
                >
                  {colorMode === "light" ? t("header.darkMode", "Dark Mode") : t("header.lightMode", "Light Mode")}
                </MenuItem>

                <MenuDivider />

                {/* Logout */}
                <MenuItem
                  fontSize="sm"
                  icon={<LogoutIcon />}
                  as={Link}
                  to="/login"
                >
                  {t("header.logout")}
                </MenuItem>
              </MenuList>
            </Menu>
          )}

        </HStack>
      </Box>
    </HStack>
  );
};
