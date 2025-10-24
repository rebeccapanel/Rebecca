import { Box, VStack, Text, Select, HStack, useColorMode } from "@chakra-ui/react";
import { useNodesQuery } from "contexts/NodesContext";
import { FC, useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import useWebSocket from "react-use-websocket";
import { getAuthToken } from "utils/authStorage";
import { joinPaths } from "@remix-run/router";
import { debounce } from "lodash";

const MAX_NUMBER_OF_LOGS = 500;

const getWebsocketUrl = (nodeID: string) => {
  try {
    let baseURL = new URL(
      import.meta.env.VITE_BASE_API.startsWith("/")
        ? window.location.origin + import.meta.env.VITE_BASE_API
        : import.meta.env.VITE_BASE_API
    );

    return (
      (baseURL.protocol === "https:" ? "wss://" : "ws://") +
      joinPaths([
        baseURL.host + baseURL.pathname,
        !nodeID ? "/core/logs" : `/node/${nodeID}/logs`,
      ]) +
      "?interval=1&token=" +
      getAuthToken()
    );
  } catch (e) {
    console.error("Unable to generate websocket url");
    console.error(e);
    return null;
  }
};

interface XrayLogsPageProps {
  showTitle?: boolean;
}

export const XrayLogsPage: FC<XrayLogsPageProps> = ({ showTitle = true }) => {
  const { t } = useTranslation();
  const { data: nodes } = useNodesQuery();
  const [selectedNode, setNode] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const logsDiv = useRef<HTMLDivElement | null>(null);
  const scrollShouldStayOnEnd = useRef(true);
  const { colorMode } = useColorMode();

  const handleLog = (id: string) => {
    if (id === selectedNode) return;
    else if (id === "host") {
      setNode("");
      setLogs([]);
    } else {
      setNode(id);
      setLogs([]);
    }
  };

  const updateLogs = useCallback(
    debounce((logs: string[]) => {
      const isScrollOnEnd =
        Math.abs(
          (logsDiv.current?.scrollTop || 0) -
            (logsDiv.current?.scrollHeight || 0) +
            (logsDiv.current?.offsetHeight || 0)
        ) < 10;
      if (logsDiv.current && isScrollOnEnd)
        scrollShouldStayOnEnd.current = true;
      else scrollShouldStayOnEnd.current = false;
      if (logs.length < MAX_NUMBER_OF_LOGS) setLogs(logs);
    }, 300),
    []
  );

  const { readyState } = useWebSocket(getWebsocketUrl(selectedNode), {
    onMessage: (e: any) => {
      logs.push(e.data);
      if (logs.length > MAX_NUMBER_OF_LOGS)
        logs.splice(0, logs.length - MAX_NUMBER_OF_LOGS);
      updateLogs([...logs]);
    },
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 1000,
  });

  useEffect(() => {
    if (logsDiv.current && scrollShouldStayOnEnd.current)
      logsDiv.current.scrollTop = logsDiv.current?.scrollHeight;
  }, [logs]);

  return (
    <VStack spacing={6} align="stretch">
      {showTitle && (
        <Text as="h1" fontWeight="semibold" fontSize="2xl">
          {t("header.xrayLogs")}
        </Text>
      )}
      <HStack>
        {nodes?.[0] && (
          <Select
            size="sm"
            width="auto"
            bg={colorMode === "dark" ? "gray.700" : "white"}
            onChange={(e) => handleLog(e.target.value)}
          >
            <option value="host">{t("core.master")}</option>
            {nodes.map((s) => (
              <option key={s.address} value={String(s.id)}>
                {t(s.name)}
              </option>
            ))}
          </Select>
        )}
        <Text>{t(`core.socket.${readyState}`)}</Text>
      </HStack>
      <Box
        border="1px solid"
        borderColor={colorMode === "dark" ? "gray.500" : "gray.300"}
        bg={colorMode === "dark" ? "#2e3440" : "#F9F9F9"}
        borderRadius={5}
        minHeight="200px"
        maxHeight="500px"
        p={2}
        overflowY="auto"
        ref={logsDiv}
      >
        {logs.map((message, i) => (
          <Text fontSize="xs" opacity={0.8} key={i} whiteSpace="pre-line">
            {message}
          </Text>
        ))}
      </Box>
    </VStack>
  );
};

export default XrayLogsPage;
