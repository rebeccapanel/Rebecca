import {
	Check,
	CircleAlert,
	Info,
	LoaderCircle,
	TriangleAlert,
	X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useColorMode } from "lib/color-mode";

const Toaster = (props: ToasterProps) => {
	const { colorMode } = useColorMode();
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";

	return (
		<Sonner
			theme={colorMode}
			dir={isRTL ? "rtl" : "ltr"}
			className="toaster group"
			position="top-center"
			swipeDirections={["top", "left", "right"]}
			duration={5000}
			gap={10}
			visibleToasts={4}
			offset={{ top: 14 }}
			mobileOffset={{
				top: "calc(env(safe-area-inset-top, 0px) + 10px)",
				left: 12,
				right: 12,
			}}
			closeButton
			icons={{
				success: <Check className="size-4" strokeWidth={2.4} />,
				error: <CircleAlert className="size-4" strokeWidth={2} />,
				warning: <TriangleAlert className="size-4" strokeWidth={2} />,
				info: <Info className="size-4" strokeWidth={2} />,
				loading: (
					<LoaderCircle className="size-4 animate-spin" strokeWidth={2} />
				),
				close: <X className="size-3.5" strokeWidth={2} />,
			}}
			toastOptions={{
				unstyled: true,
				closeButtonAriaLabel: t("close"),
				classNames: {
					toast:
						"group/toast pointer-events-auto relative flex w-full cursor-grab items-center gap-3 overflow-hidden rounded-[18px] border border-panel-border! bg-panel-surface p-3 pe-2.5 text-start font-sans text-panel-text shadow-[0_18px_46px_-12px_rgba(0,0,0,0.28),inset_0_1px_0_0_rgba(255,255,255,0.75)] select-none has-[[data-description]]:items-start active:cursor-grabbing active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-panel-accent data-[type=success]:border-emerald-500/45! data-[type=success]:bg-[color-mix(in_srgb,#10b981_16%,var(--rb-panel-surface))]! dark:data-[type=success]:border-emerald-400/40! dark:data-[type=success]:bg-[color-mix(in_srgb,#10b981_22%,var(--rb-panel-surface))]! min-[769px]:data-[type=success]:hover:border-emerald-500/65! data-[type=error]:border-red-500/40! data-[type=error]:bg-[color-mix(in_srgb,#ef4444_14%,var(--rb-panel-surface))]! dark:data-[type=error]:border-red-400/35! dark:data-[type=error]:bg-[color-mix(in_srgb,#ef4444_20%,var(--rb-panel-surface))]! min-[769px]:data-[type=error]:hover:border-red-500/60! data-[type=warning]:border-amber-500/40! data-[type=warning]:bg-[color-mix(in_srgb,#f59e0b_14%,var(--rb-panel-surface))]! dark:data-[type=warning]:border-amber-400/35! dark:data-[type=warning]:bg-[color-mix(in_srgb,#f59e0b_18%,var(--rb-panel-surface))]! min-[769px]:data-[type=warning]:hover:border-amber-500/60! data-[type=info]:border-panel-accent/40! data-[type=info]:bg-[color-mix(in_srgb,var(--rb-panel-accent)_14%,var(--rb-panel-surface))]! dark:data-[type=info]:bg-[color-mix(in_srgb,var(--rb-panel-accent)_20%,var(--rb-panel-surface))]! min-[769px]:data-[type=info]:hover:border-panel-accent/60! min-[769px]:hover:border-panel-border-strong! dark:shadow-[0_22px_56px_-12px_rgba(0,0,0,0.62),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
					icon:
						"flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-panel-border! bg-panel-elevated text-panel-text-secondary transition-colors duration-150 group-data-[type=success]/toast:border-emerald-400/50! group-data-[type=success]/toast:bg-emerald-500 group-data-[type=success]/toast:text-white group-data-[type=error]/toast:border-red-400/50! group-data-[type=error]/toast:bg-red-500 group-data-[type=error]/toast:text-white group-data-[type=warning]/toast:border-amber-400/50! group-data-[type=warning]/toast:bg-amber-500 group-data-[type=warning]/toast:text-white group-data-[type=info]/toast:border-panel-accent/50! group-data-[type=info]/toast:bg-panel-accent group-data-[type=info]/toast:text-white group-data-[type=loading]/toast:border-panel-border! group-data-[type=loading]/toast:bg-panel-elevated group-data-[type=loading]/toast:text-panel-accent",
					content: "flex min-w-0 flex-1 flex-col gap-0.5 text-start",
					title:
						"text-[13px] font-bold leading-snug tracking-[-0.01em] text-panel-text [text-wrap:pretty] group-data-[type=success]/toast:text-emerald-950 dark:group-data-[type=success]/toast:text-emerald-50 group-data-[type=error]/toast:text-red-950 dark:group-data-[type=error]/toast:text-red-50 group-data-[type=warning]/toast:text-amber-950 dark:group-data-[type=warning]/toast:text-amber-50",
					description:
						"text-[12px] font-medium leading-relaxed text-panel-text-secondary [text-wrap:pretty] group-data-[type=success]/toast:text-emerald-800/85 dark:group-data-[type=success]/toast:text-emerald-200/85 group-data-[type=error]/toast:text-red-800/85 dark:group-data-[type=error]/toast:text-red-200/85 group-data-[type=warning]/toast:text-amber-800/85 dark:group-data-[type=warning]/toast:text-amber-200/85",
					closeButton:
						"order-last relative ms-0.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-transparent text-panel-text-muted transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none active:scale-[0.9] active:bg-panel-elevated focus-visible:ring-2 focus-visible:ring-panel-accent/50 min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text group-data-[type=success]/toast:text-emerald-800/70 dark:group-data-[type=success]/toast:text-emerald-200/75 min-[769px]:group-data-[type=success]/toast:hover:bg-emerald-500/18 min-[769px]:group-data-[type=success]/toast:hover:text-emerald-950 dark:min-[769px]:group-data-[type=success]/toast:hover:text-emerald-50 group-data-[type=error]/toast:text-red-800/70 dark:group-data-[type=error]/toast:text-red-200/75 min-[769px]:group-data-[type=error]/toast:hover:bg-red-500/18 min-[769px]:group-data-[type=error]/toast:hover:text-red-950 dark:min-[769px]:group-data-[type=error]/toast:hover:text-red-50 group-data-[type=warning]/toast:text-amber-800/70 dark:group-data-[type=warning]/toast:text-amber-200/75 min-[769px]:group-data-[type=warning]/toast:hover:bg-amber-500/18 min-[769px]:group-data-[type=warning]/toast:hover:text-amber-950 dark:min-[769px]:group-data-[type=warning]/toast:hover:text-amber-50 after:absolute after:-inset-2 after:content-['']",
					actionButton:
						"inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-panel-accent px-2.5 text-[11.5px] font-semibold text-white transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none active:scale-[0.96] min-[769px]:hover:bg-panel-accent-hover",
					cancelButton:
						"inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-panel-elevated px-2.5 text-[11.5px] font-semibold text-panel-text-secondary transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none active:scale-[0.96] min-[769px]:hover:text-panel-text",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
export { toast } from "sonner";
