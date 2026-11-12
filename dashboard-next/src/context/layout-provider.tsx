import { createContext, useCallback, useContext, useState } from "react"

import { getCookie, setCookie } from "@/lib/cookies"

export type Collapsible = "offcanvas" | "icon" | "none"
export type SidebarVariant = "inset" | "sidebar" | "floating"

const COLLAPSIBLE_KEY = "rebecca.layout.collapsible"
const VARIANT_KEY = "rebecca.layout.variant"
const MAX_AGE = 60 * 60 * 24 * 30

const DEFAULT_VARIANT: SidebarVariant = "inset"
const DEFAULT_COLLAPSIBLE: Collapsible = "icon"

type LayoutContextValue = {
  collapsible: Collapsible
  setCollapsible: (value: Collapsible) => void
  variant: SidebarVariant
  setVariant: (value: SidebarVariant) => void
  resetLayout: () => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

const isCollapsible = (value: string | undefined): value is Collapsible =>
  value === "offcanvas" || value === "icon" || value === "none"

const isVariant = (value: string | undefined): value is SidebarVariant =>
  value === "inset" || value === "sidebar" || value === "floating"

/**
 * Sidebar shape preferences, persisted so a reload keeps the operator's layout.
 * The reference app stores these in cookies; the same storage key scheme is
 * used here so the shell behaves identically.
 */
export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [collapsible, setCollapsibleState] = useState<Collapsible>(() => {
    const saved = getCookie(COLLAPSIBLE_KEY)
    return isCollapsible(saved) ? saved : DEFAULT_COLLAPSIBLE
  })

  const [variant, setVariantState] = useState<SidebarVariant>(() => {
    const saved = getCookie(VARIANT_KEY)
    return isVariant(saved) ? saved : DEFAULT_VARIANT
  })

  const setCollapsible = useCallback((next: Collapsible) => {
    setCollapsibleState(next)
    setCookie(COLLAPSIBLE_KEY, next, MAX_AGE)
  }, [])

  const setVariant = useCallback((next: SidebarVariant) => {
    setVariantState(next)
    setCookie(VARIANT_KEY, next, MAX_AGE)
  }, [])

  const resetLayout = useCallback(() => {
    setCollapsible(DEFAULT_COLLAPSIBLE)
    setVariant(DEFAULT_VARIANT)
  }, [setCollapsible, setVariant])

  return (
    <LayoutContext value={{ collapsible, setCollapsible, variant, setVariant, resetLayout }}>
      {children}
    </LayoutContext>
  )
}

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) throw new Error("useLayout must be used within a LayoutProvider")
  return context
}
