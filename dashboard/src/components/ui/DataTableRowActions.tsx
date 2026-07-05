import {
	chakra,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
} from "@chakra-ui/react";
import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
import { Fragment, type FC, type ReactElement, type ReactNode } from "react";

const EllipsisIcon = chakra(EllipsisHorizontalIcon, {
	baseStyle: { w: 5, h: 5 },
});

export type RowActionItem = {
	id: string;
	label: ReactNode;
	icon?: ReactElement;
	onClick?: () => void;
	render?: (onClose: () => void) => ReactNode;
	isDisabled?: boolean;
	isDanger?: boolean;
	color?: string;
};

type RowActionsMenuProps = {
	actions: RowActionItem[];
	label?: string;
};

const getActionLabelText = (label: RowActionItem["label"]) =>
	typeof label === "string" || typeof label === "number"
		? String(label)
		: "";

const getActionPriority = (action: RowActionItem) => {
	const id = action.id.toLowerCase();
	const label = getActionLabelText(action.label).toLowerCase();
	if (id.includes("edit") || label.includes("edit")) return 0;
	if (action.isDanger || id.includes("delete") || label.includes("delete")) {
		return 100;
	}
	return 50;
};

export const orderRowActions = <TAction extends RowActionItem>(
	actions: TAction[],
) =>
	[...actions].sort((first, second) => {
		const priorityDelta = getActionPriority(first) - getActionPriority(second);
		if (priorityDelta !== 0) return priorityDelta;
		return 0;
	});

export const RowActionsMenu: FC<RowActionsMenuProps> = ({
	actions,
	label = "Actions",
}) => {
	if (actions.length === 0) return null;
	const orderedActions = orderRowActions(actions);

	return (
		<Menu placement="auto-end" strategy="fixed" autoSelect={false}>
			{({ onClose }) => (
				<>
					<MenuButton
						as={IconButton}
						aria-label={label}
						icon={<EllipsisIcon />}
						size="sm"
						variant="ghost"
						className="rb-row-action"
						minW="32px"
						h="32px"
						onClick={(event) => event.stopPropagation()}
					/>
					<Portal>
						<MenuList
							minW="220px"
							maxW="calc(100vw - 24px)"
							maxH="min(70vh, 420px)"
							overflowY="auto"
							zIndex={2500}
							borderRadius="lg"
							boxShadow="2xl"
						>
							{orderedActions.map((action) =>
								action.render ? (
									<Fragment key={action.id}>
										{action.render(onClose)}
									</Fragment>
								) : (
									<MenuItem
										key={action.id}
										icon={action.icon}
										onClick={(event) => {
											event.stopPropagation();
											action.onClick?.();
										}}
										isDisabled={action.isDisabled}
										color={
											action.color ?? (action.isDanger ? "red.400" : undefined)
										}
									>
										{action.label}
									</MenuItem>
								),
							)}
						</MenuList>
					</Portal>
				</>
			)}
		</Menu>
	);
};
