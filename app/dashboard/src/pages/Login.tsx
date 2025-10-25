import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  chakra,
  FormControl,
  FormLabel,
  FormErrorMessage,
  Input as CInput,
  InputGroup,
  InputRightElement,
  HStack,
  IconButton,
  Text,
  VStack,
  useColorMode,
  useColorModeValue,
} from "@chakra-ui/react";
import { ArrowRightOnRectangleIcon, EyeIcon, EyeSlashIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { FC, useEffect, useState } from "react";
import { FieldValues, useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Input } from "components/Input";
import { fetch } from "service/http";
import { removeAuthToken, setAuthToken } from "utils/authStorage";
import { ReactComponent as Logo } from "assets/logo.svg";
import { useTranslation } from "react-i18next";
import { Language } from "components/Language";

const schema = z.object({
  username: z.string().min(1, "login.fieldRequired"),
  password: z.string().min(1, "login.fieldRequired"),
});

export const LogoIcon = chakra(Logo, {
  baseStyle: {
    strokeWidth: "10px",
    w: 12,
    h: 12,
  },
});

const LoginIcon = chakra(ArrowRightOnRectangleIcon, {
  baseStyle: {
    w: 5,
    h: 5,
    strokeWidth: "2px",
  },
});

const DarkIcon = chakra(MoonIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const LightIcon = chakra(SunIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const Eye = chakra(EyeIcon, { baseStyle: { w: 4, h: 4 } });
const EyeSlash = chakra(EyeSlashIcon, { baseStyle: { w: 4, h: 4 } });

export const Login: FC = () => {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { colorMode, toggleColorMode } = useColorMode();
  // slightly off-white in light mode so the card is visible against a plain white page
  const cardBg = useColorModeValue("gray.50", "gray.700");
  const cardBorder = useColorModeValue("gray.200", "gray.600");
  let location = useLocation();
  const {
    register,
    formState: { errors },
    handleSubmit,
  } = useForm({
    resolver: zodResolver(schema),
  });
  useEffect(() => {
    removeAuthToken();
    if (location.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, []);
  const login = (values: FieldValues) => {
    setError("");
    const formData = new FormData();
    formData.append("username", values.username);
    formData.append("password", values.password);
    formData.append("grant_type", "password");
    setLoading(true);
    fetch("/admin/token", { method: "post", body: formData })
      .then(({ access_token: token }) => {
        console.log("Token received:", token);
        setAuthToken(token);
        navigate("/");
      })
      .catch((err) => {
        setError(err.response?._data?.detail || "Login failed");
      })
      .finally(() => setLoading(false));
  };
  return (
    <VStack justifyContent="center" minH="100vh" p="6" w="full">
      <Card
        maxW="500px"
        w="full"
        bg={cardBg}
        borderWidth="1px"
        borderColor={cardBorder}
        boxShadow="md"
      >
        <CardBody>
          <HStack justifyContent="end" spacing={2} mb={6}>
            <Language />
            <IconButton
              size="sm"
              variant="outline"
              aria-label="switch theme"
              onClick={toggleColorMode}
            >
              {colorMode === "light" ? <DarkIcon /> : <LightIcon />}
            </IconButton>
          </HStack>
          <VStack alignItems="center" w="full" spacing={4}>
            <LogoIcon />
            <Text fontSize="2xl" fontWeight="semibold">
              {t("login.loginYourAccount")}
            </Text>
            <Text color="gray.600" _dark={{ color: "gray.400" }}>
              {t("login.welcomeBack")}
            </Text>
          </VStack>
          <Box w="full" pt="4">
            <form onSubmit={handleSubmit(login)}>
              <VStack spacing={4}>
                <FormControl>
                  <Input
                    w="full"
                    placeholder={t("username")}
                    {...register("username")}
                    error={t(errors?.username?.message as string)}
                  />
                </FormControl>
                <FormControl isInvalid={!!errors.password}>
                  <InputGroup>
                    <CInput
                      w="full"
                      type={showPassword ? "text" : "password"}
                      placeholder={t("password")}
                      {...register("password")}
                    />
                    <InputRightElement>
                      <IconButton
                        aria-label={
                          showPassword ? t("admins.hidePassword", "Hide") : t("admins.showPassword", "Show")
                        }
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowPassword(!showPassword)}
                        icon={showPassword ? <EyeSlash /> : <Eye />}
                      />
                    </InputRightElement>
                  </InputGroup>
                  <FormErrorMessage>
                    {errors.password?.message as string}
                  </FormErrorMessage>
                </FormControl>
                {error && (
                  <Alert status="error" rounded="md">
                    <AlertIcon />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  isLoading={loading}
                  type="submit"
                  w="full"
                  colorScheme="primary"
                >
                  {<LoginIcon marginRight={1} />}
                  {t("login")}
                </Button>
              </VStack>
            </form>
          </Box>
        </CardBody>
      </Card>
    </VStack>
  );
};

export default Login;