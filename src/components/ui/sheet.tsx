import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { useDialogContainer, useDialogPresentation, useWorkspaceModalMode, DialogPresentationContext } from "./portal-container";
import { cn } from "@/lib/utils";
const Sheet = ({ modal = true, open, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const docked = useWorkspaceModalMode(isOpen);
  return <DialogPresentationContext.Provider value={docked}><SheetPrimitive.Root open={isOpen} modal={docked ? false : modal}
    onOpenChange={(next) => { setInternalOpen(next); onOpenChange?.(next); }} {...props} /></DialogPresentationContext.Provider>;
};
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = ({ container, ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) => {
  const defaultContainer = useDialogContainer();
  return <SheetPrimitive.Portal container={container ?? defaultContainer} {...props} />;
};
const SheetOverlay = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>>(({
  className,
  ...props
}, ref) => {
  const docked = useDialogPresentation();
  if (docked) return <div ref={ref} className={cn("pointer-events-auto fixed inset-0 z-50 bg-black/80", className)} />;
  return <SheetPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", className)} {...props} ref={ref} />;
});
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;
const sheetVariants = cva("fixed z-50 gap-4 bg-background px-6 pb-6 pt-safe shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500", {
  variants: {
    side: {
      top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
      bottom: "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
      left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
      right: "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm"
    }
  },
  defaultVariants: {
    side: "right"
  }
});
interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {}
const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(({
  side = "right",
  className,
  children,
  onInteractOutside,
  ...props
}, ref) => {
  const handleOpenAutoFocus = (e: Event) => {
    // Prevent autofocus on mobile to avoid keyboard popup
    if (window.matchMedia('(max-width: 768px)').matches) {
      e.preventDefault();
    }
  };

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content 
        ref={ref} 
      data-workspace-dialog-content="sheet"
      onInteractOutside={(e) => {
        onInteractOutside?.(e);
        if (e.target instanceof Element && e.target.closest('[aria-label="Inbox lateral"], [data-inbox-workspace-control]')) e.preventDefault();
      }}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={cn("pointer-events-auto", sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-safe top-safe translate-y-[25px] rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-secondary hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none p-2">
          <X className="w-4 h-4" />
          <span className="sr-only">Fechar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;
const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />;
SheetHeader.displayName = "SheetHeader";
const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />;
SheetFooter.displayName = "SheetFooter";
const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(({
  className,
  ...props
}, ref) => <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />);
SheetTitle.displayName = SheetPrimitive.Title.displayName;
const SheetDescription = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Description>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>>(({
  className,
  ...props
}, ref) => <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />);
SheetDescription.displayName = SheetPrimitive.Description.displayName;
export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetOverlay, SheetPortal, SheetTitle, SheetTrigger };