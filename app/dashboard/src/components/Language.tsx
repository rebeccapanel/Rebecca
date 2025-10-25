import {
  chakra,
  HStack,
  IconButton,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
} from "@chakra-ui/react";
import { CheckIcon, LanguageIcon } from "@heroicons/react/24/outline";
import ReactCountryFlag from 'react-country-flag';
import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";

type HeaderProps = {
  actions?: ReactNode;
};

const LangIcon = chakra(LanguageIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const CheckIconChakra = chakra(CheckIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

export const Language: FC<HeaderProps> = ({ actions }) => {
  const { i18n } = useTranslation();

  var changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <Menu placement="bottom-end">
      <MenuButton
        as={IconButton}
        size="sm"
        variant="outline"
        icon={<LangIcon />}
        position="relative"
      />
      <MenuList minW="160px" zIndex={9999}>
        <MenuItem
          fontSize="sm"
          onClick={() => changeLanguage("en")}
        >
          <HStack justify="space-between" w="full">
            <HStack spacing={2}>
              <ReactCountryFlag countryCode="US" svg style={{width: '16px', height: '12px'}} />
              <Text>English</Text>
            </HStack>
            {i18n.language === "en" && <CheckIconChakra />}
          </HStack>
        </MenuItem>
        <MenuItem
          fontSize="sm"
          onClick={() => changeLanguage("fa")}
        >
          <HStack justify="space-between" w="full">
            <HStack spacing={2}>
              <ReactCountryFlag countryCode="IR" svg style={{width: '16px', height: '12px'}} />
              <Text>فارسی</Text>
            </HStack>
            {i18n.language === "fa" && <CheckIconChakra />}
          </HStack>
        </MenuItem>
        <MenuItem
          fontSize="sm"
          onClick={() => changeLanguage("zh-cn")}
        >
          <HStack justify="space-between" w="full">
            <HStack spacing={2}>
              <ReactCountryFlag countryCode="CN" svg style={{width: '16px', height: '12px'}} />
              <Text>简体中文</Text>
            </HStack>
            {i18n.language === "zh-cn" && <CheckIconChakra />}
          </HStack>
        </MenuItem>
        <MenuItem
          fontSize="sm"
          onClick={() => changeLanguage("ru")}
        >
          <HStack justify="space-between" w="full">
            <HStack spacing={2}>
              <ReactCountryFlag countryCode="RU" svg style={{width: '16px', height: '12px'}} />
              <Text>Русский</Text>
            </HStack>
            {i18n.language === "ru" && <CheckIconChakra />}
          </HStack>
        </MenuItem>
      </MenuList>
    </Menu>
  );
};
