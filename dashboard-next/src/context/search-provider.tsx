import { useCallback, useEffect, useState } from "react"


type SearchContextValue = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const SearchContext = createContext<SearchContextValue | null>(null)

import { createContext, useContext } from "react"

/** Global command palette state, bound to ⌘K / Ctrl+K. */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const value = useCallback(() => ({ open, setOpen }), [open])

  // The palette itself mounts inside the router (see AppLayout): it needs
  // `useNavigate`, which is unavailable above <RouterProvider>.
  return <SearchContext value={value()}>{children}</SearchContext>
}

export function useSearch() {
  const context = useContext(SearchContext)
  if (!context) throw new Error("useSearch must be used within SearchProvider")
  return context
}
