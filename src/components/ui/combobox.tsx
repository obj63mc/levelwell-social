import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Combobox<T>({ ...props }: ComboboxPrimitive.Root.Props<T>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />
}

function ComboboxInputGroup({ className, ...props }: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        "border-input bg-transparent dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex h-9 w-full items-center gap-1 rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn("placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none", className)}
      {...props}
    />
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      aria-label="Clear"
      className={cn("text-muted-foreground hover:text-foreground shrink-0 rounded-sm outline-none", className)}
      {...props}
    >
      <XIcon className="size-4" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxIcon({ className, ...props }: ComboboxPrimitive.Icon.Props) {
  return (
    <ComboboxPrimitive.Icon
      data-slot="combobox-icon"
      className={cn("text-muted-foreground shrink-0", className)}
      {...props}
    >
      <ChevronsUpDownIcon className="size-4" />
    </ComboboxPrimitive.Icon>
  )
}

function ComboboxContent({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner className="isolate z-50 outline-none" sideOffset={4}>
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "bg-popover text-popover-foreground z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg p-1 shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ ...props }: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot="combobox-list" {...props} />
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("text-muted-foreground px-2 py-3 text-center text-xs empty:hidden", className)}
      {...props}
    />
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none select-none",
        className,
      )}
      {...props}
    >
      <ComboboxPrimitive.ItemIndicator className="absolute left-2 flex items-center">
        <CheckIcon className="size-3.5" />
      </ComboboxPrimitive.ItemIndicator>
      {children}
    </ComboboxPrimitive.Item>
  )
}

export {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
}
