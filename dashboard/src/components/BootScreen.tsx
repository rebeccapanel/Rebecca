import logoUrl from "assets/logo.svg";

export const BootScreen = () => (
	<div className="grid min-h-[100dvh] place-items-center bg-panel-app px-4 select-none">
		<div className="flex flex-col items-center gap-4">
			<div className="rb-skeleton-sweep relative flex size-[68px] items-center justify-center rounded-[20px] border border-panel-border! bg-panel-surface shadow-[0_18px_48px_-12px_rgba(0,0,0,0.28),inset_0_1px_0_0_rgba(255,255,255,0.75)] dark:shadow-[0_22px_56px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.08)]">
				<img
					src={logoUrl}
					alt=""
					aria-hidden="true"
					draggable={false}
					className="pointer-events-none size-8 object-contain select-none [-webkit-user-drag:none] [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]"
				/>
			</div>
			<span className="text-[12px] font-bold uppercase tracking-[0.22em] text-panel-text-secondary">
				Rebecca
			</span>
			<div
				aria-hidden="true"
				className="relative h-[3px] w-28 overflow-hidden rounded-full bg-panel-elevated"
			>
				<div className="rb-boot-bar h-full w-1/2 rounded-full bg-panel-accent" />
			</div>
		</div>
	</div>
);
