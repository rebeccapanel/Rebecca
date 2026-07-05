import { Box, HStack, Text } from "@chakra-ui/react";
import { StarIcon } from "@heroicons/react/24/solid";
import { type FC, useEffect, useState } from "react";

export const GitHubStars: FC = () => {
	const [stars, setStars] = useState<number | null>(null);

	useEffect(() => {
		fetch("https://api.github.com/repos/rebeccapanel/Rebecca")
			.then((res) => res.json())
			.then((data) => {
				if (data.stargazers_count) {
					setStars(data.stargazers_count);
				}
			})
			.catch(() => {
				// Silently fail if API is unavailable
			});
	}, []);

	const handleClick = () => {
		window.open(
			"https://github.com/rebeccapanel/Rebecca",
			"_blank",
			"noopener,noreferrer",
		);
	};

	return (
		<Box
			as="button"
			onClick={handleClick}
			px={2.5}
			h="34px"
			minH="34px"
			borderRadius="4px"
			borderWidth="1px"
			borderColor="panel.border"
			bg="panel.surface"
			color="panel.textSecondary"
			display="inline-flex"
			alignItems="center"
			justifyContent="center"
			_hover={{
				bg: "panel.elevated",
				borderColor: "panel.borderStrong",
				color: "panel.text",
			}}
			_active={{ bg: "panel.surface" }}
			_focusVisible={{
				boxShadow: "0 0 0 2px var(--rb-panel-accent)",
				outline: "none",
			}}
			transition="background 0.15s ease, border-color 0.15s ease, color 0.15s ease"
			cursor="pointer"
			aria-label="GitHub Stars"
		>
			<HStack spacing={1.5} align="center">
				<svg
					width="17"
					height="17"
					viewBox="0 0 24 24"
					fill="currentColor"
					xmlns="http://www.w3.org/2000/svg"
				>
					<title>GitHub</title>
					<path
						fillRule="evenodd"
						clipRule="evenodd"
						d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
					/>
				</svg>
				<StarIcon style={{ width: "13px", height: "13px", color: "currentColor" }} />
				<Text
					fontSize="xs"
					fontWeight="700"
					color={stars !== null ? "panel.text" : "panel.textMuted"}
					lineHeight="1"
				>
					{stars !== null
						? stars > 1000
							? `${(stars / 1000).toFixed(1)}k`
							: stars
						: "..."}
				</Text>
			</HStack>
		</Box>
	);
};
