import { type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "lib/cn";

type SectionEntry = {
	id: string;
	title: string;
	parentId: string | null;
	element: HTMLElement;
};

const ACTIVE_OFFSET = 24;
const RELEASE_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

const rootIdOf = (entry: SectionEntry, entries: SectionEntry[]): string => {
	const parent = entry.parentId ? entries.find((item) => item.id === entry.parentId) : undefined;
	return parent ? rootIdOf(parent, entries) : entry.id;
};

export const InboundSectionNav = ({
	containerRef,
	resetKey,
}: {
	containerRef: RefObject<HTMLDivElement | null>;
	resetKey: unknown;
}) => {
	const [entries, setEntries] = useState<SectionEntry[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const pinnedRef = useRef<string | null>(null);
	const applyActiveRef = useRef<(id: string | null) => void>(() => undefined);
	const navRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const chip = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
		const nav = chip?.parentElement;
		if (!chip || !nav) return;
		nav.scrollTo({ left: chip.offsetLeft - (nav.clientWidth - chip.clientWidth) / 2, behavior: "smooth" });
	}, [activeId]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let current: SectionEntry[] = [];
		let frame = 0;

		const applyActive = (id: string | null) => {
			const active = current.find((entry) => entry.id === id);
			const siblings = active ? current.filter((entry) => entry.parentId === active.parentId) : [];
			const nextId = active ? (siblings[siblings.indexOf(active) + 1]?.id ?? null) : null;
			Array.from(container.querySelectorAll<HTMLElement>("[data-form-section]")).forEach((element) => {
				element.dataset.active = String(element.dataset.formSection === id);
				element.dataset.nextActive = String(element.dataset.formSection === nextId);
			});
			setActiveId(id);
		};
		applyActiveRef.current = applyActive;

		const updateActive = () => {
			if (pinnedRef.current) {
				applyActive(pinnedRef.current);
				return;
			}
			if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
				applyActive(current[current.length - 1]?.id ?? null);
				return;
			}
			const threshold = container.getBoundingClientRect().top + ACTIVE_OFFSET;
			let next = current[0]?.id ?? null;
			for (const entry of current) {
				if (entry.element.getBoundingClientRect().top <= threshold) next = entry.id;
			}
			applyActive(next);
		};

		const collect = () => {
			frame = 0;
			const visible = Array.from(container.querySelectorAll<HTMLElement>("[data-form-section]")).filter(
				(element) => element.getClientRects().length > 0,
			);
			current = visible.map((element) => ({
				id: element.dataset.formSection ?? "",
				title: element.dataset.formSectionTitle ?? "",
				parentId: element.parentElement?.closest<HTMLElement>("[data-form-section]")?.dataset.formSection ?? null,
				element,
			}));
			setEntries(current);
			updateActive();
		};

		const scheduleCollect = () => {
			if (!frame) frame = requestAnimationFrame(collect);
		};

		const release = () => {
			pinnedRef.current = null;
			updateActive();
		};

		collect();
		container.addEventListener("scroll", updateActive, { passive: true });
		RELEASE_EVENTS.forEach((type) => {
			container.addEventListener(type, release, { passive: true });
		});
		const observer = new MutationObserver(scheduleCollect);
		observer.observe(container, { childList: true, subtree: true });

		return () => {
			observer.disconnect();
			container.removeEventListener("scroll", updateActive);
			RELEASE_EVENTS.forEach((type) => {
				container.removeEventListener(type, release);
			});
			if (frame) cancelAnimationFrame(frame);
		};
	}, [containerRef, resetKey]);

	const navigateTo = (entry: SectionEntry) => {
		const container = containerRef.current;
		if (!container) return;
		pinnedRef.current = entry.id;
		applyActiveRef.current(entry.id);
		const offset = entry.element.getBoundingClientRect().top - container.getBoundingClientRect().top;
		container.scrollTo({ top: container.scrollTop + offset - 12, behavior: "smooth" });
	};

	if (entries.length < 2) return null;

	const roots = entries.filter((entry) => !entry.parentId);
	const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;
	const activeRootId = activeEntry ? rootIdOf(activeEntry, entries) : null;
	const children = entries.filter((entry) => entry.parentId && entry.parentId === activeRootId);

	return (
		<div ref={navRef} className="flex flex-col gap-1.5">
			<nav className="relative flex flex-nowrap gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible">
				{roots.map((entry) => {
					const isActive = entry.id === activeRootId;
					return (
						<button
							key={entry.id}
							type="button"
							aria-current={isActive ? "true" : undefined}
							onClick={() => navigateTo(entry)}
							className={cn(
								"shrink-0 rounded-md border px-2.5 py-1 text-[0.8125rem] font-medium transition-colors",
								isActive
									? "border-primary/40 bg-primary/15 text-primary"
									: "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{entry.title}
						</button>
					);
				})}
			</nav>
			{children.length > 0 ? (
				<nav className="relative flex flex-nowrap gap-1 overflow-x-auto whitespace-nowrap ps-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible">
					{children.map((entry) => {
						const isActive = entry.id === activeId;
						return (
							<button
								key={entry.id}
								type="button"
								aria-current={isActive ? "true" : undefined}
								onClick={() => navigateTo(entry)}
								className={cn(
									"shrink-0 rounded px-2 py-0.5 text-[0.75rem] transition-colors",
									isActive
										? "bg-muted font-semibold text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{entry.title}
							</button>
						);
					})}
				</nav>
			) : null}
		</div>
	);
};
