import { chakra } from "@chakra-ui/react";
import { TrashIcon } from "@heroicons/react/24/outline";

export const DeleteIcon = chakra(TrashIcon, {
	baseStyle: {
		w: 5,
		h: 5,
	},
});
