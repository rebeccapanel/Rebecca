import {
  Box,
  Button,
  chakra,
  Divider,
  HStack,
  IconButton,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import {
  ArrowLeftOnRectangleIcon,
  Bars3Icon,
  Cog6ToothIcon,
  DocumentMinusIcon,
  LinkIcon,
  SquaresPlusIcon,
  EllipsisVerticalIcon,
  LanguageIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { GitHubStars } from "./GitHubStars";
import ThemeSelector from "./ThemeSelector";
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

const CoreSettingsIcon = chakra(Cog6ToothIcon, iconProps);
const SettingsIcon = chakra(Bars3Icon, iconProps);
const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const HostsIcon = chakra(LinkIcon, iconProps);
const NodesIcon = chakra(SquaresPlusIcon, iconProps);
const ResetUsageIcon = chakra(DocumentMinusIcon, iconProps);
const MoreIcon = chakra(EllipsisVerticalIcon, iconProps);
const LanguageIconStyled = chakra(LanguageIcon, iconProps);

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
  const actionsMenu = useDisclosure();

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
                </>
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
                    aria-label="more options"
                    onClick={() =>
                      actionsMenu.isOpen ? actionsMenu.onClose() : actionsMenu.onOpen()
                    }
                  />
                </PopoverTrigger>
                <PopoverContent w={{ base: "90vw", sm: "56" }}>
                  <PopoverArrow />
                  <PopoverBody>
                    <Stack spacing={2}>
                      <Menu placement="left-start">
                        <MenuButton
                          as={Button}
                          justifyContent="space-between"
                          rightIcon={<LanguageIconStyled />}
                          variant="ghost"
                        >
                          {t("header.language", "Language")}
                        </MenuButton>
                        <MenuList minW={{ base: "100%", sm: "200px" }}>
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
                                    <ReactCountryFlag
                                      countryCode={flag}
                                      svg
                                      style={{ width: "16px", height: "12px" }}
                                    />
                                    <Text>{label}</Text>
                                  </HStack>
                                  {isActiveLang && <CheckIcon width={16} />}
                                </HStack>
                              </MenuItem>
                            );
                          })}
                        </MenuList>
                      </Menu>
                      <Divider />
                      <ThemeSelector trigger="menu" triggerLabel={t("header.theme", "Theme")} />
                      <Divider />
                      <Button
                        colorScheme="red"
                        leftIcon={<LogoutIcon />}
                        justifyContent="flex-start"
                        as={Link}
                        to="/login"
                        onClick={actionsMenu.onClose}
                      >
                        {t("header.logout")}
                      </Button>
                    </Stack>
                  </PopoverBody>
                </PopoverContent>
              </Popover>

        </HStack>
      </Box>
    </HStack>
  );
};
