import * as React from "react"
import { Drawer as SheetPrimitive } from "@base-ui/react/drawer"
import { cn } from "cn"
import { XIcon } from "lucide-react"

/**
 * Sheets are base-ui Drawers: they spring in from their edge and can be swiped away
 * (down for bottom sheets, left for the menu). `swipeDirection` must match `SheetContent`'s side.
 */
function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetContent({
  className,
  children,
  side = "bottom",
  showCloseButton = true,
  closeLabel = "Close",
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "bottom" | "left"
  showCloseButton?: boolean
  /** translated name of the close button */
  closeLabel?: string
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop data-slot="sheet-overlay" className="sheet-backdrop fixed inset-0 z-50 bg-overlay" />
      <SheetPrimitive.Viewport className={cn("fixed inset-0 z-50 flex", side === "bottom" ? "items-end justify-center" : "items-stretch justify-start")}>
        <SheetPrimitive.Popup
          data-slot="sheet-content"
          data-side={side}
          className={cn(
            "sheet-popup relative flex flex-col gap-4 bg-popover text-sm text-popover-foreground shadow-3 outline-none overscroll-contain",
            side === "bottom" ? "w-full max-w-md rounded-t-3xl pt-2" : "h-full w-3/4",
            className
          )}
          {...props}
        >
          {side === "bottom" && <div aria-hidden className="mx-auto mt-1 h-1.5 w-10 shrink-0 rounded-full bg-foreground/15" />}
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              data-slot="sheet-close"
              aria-label={closeLabel}
              className="absolute top-2 right-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted active:scale-95"
            >
              <XIcon className="size-5" />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Viewport>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-0.5 px-4 pt-2 pb-2", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-xl font-semibold tracking-tight text-foreground", className)} {...props} />
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
