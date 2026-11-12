"use client"

import * as React from "react"
import { cn } from "lib/cn"
import { ArrowLeft, XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useTranslation } from "react-i18next"

import { Button } from "components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs"
import type { EntityPageInfo } from "components/entityPage/EntityPageParts"
import {
  EDITOR_PAGE_ID,
  ENTITY_PAGE_LABELS,
  type EntityPageSection,
  useActiveEntityPage,
  useEntityPagePrefs,
} from "lib/entityPages"

type EntityPageState = { section: EntityPageSection; page?: EntityPageInfo }

const EntityPageContext = React.createContext<EntityPageState | null>(null)

function Dialog({
  section,
  page,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  section?: EntityPageSection
  page?: EntityPageInfo
}) {
  const asPage = useEntityPagePrefs((state) => Boolean(section && state.pages[section]))
  const open = Boolean(props.open)

  const pageTitle = typeof page?.title === "string" ? page.title : undefined

  React.useEffect(() => {
    if (!section || !asPage || !open) return
    useActiveEntityPage.getState().activate(section, pageTitle)
    return () => useActiveEntityPage.getState().release(section)
  }, [section, asPage, open, pageTitle])

  const pageSection = asPage && section ? section : null
  const pageState = pageSection ? { section: pageSection, page } : null

  return (
    <EntityPageContext.Provider value={pageState}>
      <DialogPrimitive.Root data-slot="dialog" modal={!pageSection} {...props} />
    </EntityPageContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-[12000] bg-black/65 data-[state=closed]:animate-rb-fade-out data-[state=open]:animate-rb-fade-in",
        className
      )}
      {...props}
    />
  )
}

function EntityPageBackLink({ section }: { section: EntityPageSection }) {
  const { t } = useTranslation()

  return (
    <DialogPrimitive.Close asChild>
      <button
        type="button"
        data-slot="entity-page-back"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t(`entityPages.${section}`, ENTITY_PAGE_LABELS[section])}
      </button>
    </DialogPrimitive.Close>
  )
}

function EntityPageBody({
  page,
  children,
}: {
  page: EntityPageInfo
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<"overview" | "settings">("overview")

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-xl font-semibold text-panel-text">{page.title}</h2>
          {page.subtitle ? (
            <p className="truncate font-mono text-sm text-panel-text-secondary">{page.subtitle}</p>
          ) : null}
        </div>
        {page.status}
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as "overview" | "settings")}>
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="overview">{t("entityPages.overview", "Overview")}</TabsTrigger>
          <TabsTrigger value="settings">{t("entityPages.settings", "Settings")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" forceMount className="pt-4 data-[state=inactive]:hidden">
          {page.overview}
        </TabsContent>
        <TabsContent
          value="settings"
          forceMount
          className="flex flex-col gap-4 pt-4 data-[state=inactive]:hidden [&_[data-slot=dialog-header]]:sr-only"
        >
          {children}
        </TabsContent>
      </Tabs>
    </>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const pageState = React.useContext(EntityPageContext)

  if (pageState) {
    return (
      <DialogPrimitive.Portal container={document.getElementById(EDITOR_PAGE_ID)}>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            className,
            "static mx-auto grid w-full max-w-[1200px] gap-5 border-0 bg-transparent p-0 shadow-none outline-none sm:max-w-[1200px] max-h-none overflow-visible"
          )}
          onInteractOutside={(event) => event.preventDefault()}
          {...props}
        >
          <EntityPageBackLink section={pageState.section} />
          {pageState.page ? <EntityPageBody page={pageState.page}>{children}</EntityPageBody> : children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )
  }

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-[12000] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-rb-pop-out data-[state=open]:animate-rb-pop-in sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 end-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-start", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const pageState = React.useContext(EntityPageContext)

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        pageState && "sticky bottom-0 z-10 border-t bg-panel-main py-3",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline" size="sm">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
