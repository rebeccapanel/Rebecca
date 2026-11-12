import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Tracks the mobile breakpoint. The first value is read during render (there is
 * no safe SSR path in this app), and the effect only subscribes to changes.
 */
export function useIsMobile() {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return isMobile
}
