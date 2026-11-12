import bootLogoUrl from "assets/boot-logo.webp";
import { useColorMode } from "lib/color-mode";

export const BootScreen = () => {
	const { colorMode } = useColorMode();

	return (
		<div className="grid min-h-[100dvh] place-items-center bg-panel-main px-4 select-none">
			<div className="flex flex-col items-center gap-3.5">
				<img
					src={bootLogoUrl}
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
					className="rb-boot-logo pointer-events-none size-11 object-contain select-none [-webkit-user-drag:none]"
				/>
				<span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-panel-text-muted">
					Rebecca
				</span>
				<div
					aria-hidden="true"
					className="relative h-[2px] w-20 overflow-hidden rounded-full bg-panel-border/60"
				>
					<div className="rb-boot-bar h-full w-2/5 rounded-full bg-panel-accent" />
				</div>
			</div>
		</div>
	);
};
