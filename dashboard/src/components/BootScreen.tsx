import logoUrl from "assets/logo.svg";
import { useColorMode } from "lib/color-mode";

export const BootScreen = () => {
	const { colorMode } = useColorMode();

	return (
		<div className="grid min-h-[100dvh] place-items-center bg-panel-main px-4 select-none">
			<div className="flex flex-col items-center gap-3.5 sm:gap-4">
				<img
					src={logoUrl}
					alt=""
					aria-hidden="true"
					draggable={false}
					loading="eager"
					decoding="sync"
					style={{
						filter:
							colorMode === "dark"
								? "brightness(0) invert(1)"
								: "brightness(0)",
					}}
					className="rb-boot-logo pointer-events-none size-10 object-contain select-none [-webkit-user-drag:none] sm:size-12 min-[769px]:size-14"
				/>
				<span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-panel-text-muted sm:text-[12px]">
					Rebecca
				</span>
				<div
					aria-hidden="true"
					className="relative h-[2px] w-20 overflow-hidden rounded-full bg-panel-border/60 sm:w-24"
				>
					<div className="rb-boot-bar h-full w-2/5 rounded-full bg-panel-accent" />
				</div>
			</div>
		</div>
	);
};
