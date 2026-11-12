import { useCallback, useState } from "react";

/** Open/close state with the same shape Chakra's useDisclosure returned. */
export function useDisclosure(initialOpen = false) {
	const [isOpen, setIsOpen] = useState(initialOpen);
	const onOpen = useCallback(() => setIsOpen(true), []);
	const onClose = useCallback(() => setIsOpen(false), []);
	const onToggle = useCallback(() => setIsOpen((open) => !open), []);
	return { isOpen, onOpen, onClose, onToggle };
}
