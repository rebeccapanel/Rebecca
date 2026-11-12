import type { FC, PropsWithChildren } from "react";

export type IconType = {
	color: string;
	size?: number;
};

/** A rounded tile in the palette colour, with two soft layers behind it. */
export const Icon: FC<PropsWithChildren<IconType>> = ({
	children,
	color,
	size = 36,
}) => {
	const baseSize = `${size}px`;
	return (
		<div
			style={{ width: baseSize, height: baseSize }}
			className={`relative flex justify-center items-center before:absolute before:inset-0 before:z-[1] before:block before:rounded-[5px] before:opacity-50 before:bg-${color}-400 dark:before:bg-${color}-400 after:absolute after:start-0 after:top-0 after:z-[1] after:block after:w-[calc(100%+10px)] after:h-[calc(100%+10px)] after:[transform:translate(-5px,-5px)] after:rounded-[8px] after:opacity-40 after:bg-${color}-400 dark:after:bg-${color}-400`}
		>
			<p className={`relative z-[2] text-${color}-500 dark:text-${color}-900`}>{children}</p>
		</div>
	);
};
