import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Select<T>({ ...props }: SelectPrimitive.Root.Props<T>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "border-input bg-transparent dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 data-disabled:opacity-50 flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-muted-foreground shrink-0">
        <ChevronsUpDownIcon className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({ className, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className="isolate z-50 outline-none" sideOffset={4} alignItemWithTrigger={false}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "bg-popover text-popover-foreground z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg p-1 shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className,
          )}
          {...props}
        />
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none select-none",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex items-center">
        <CheckIcon className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
