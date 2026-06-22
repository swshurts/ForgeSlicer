import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

// iter-105.12 — pop toasts in the centre of the screen instead of the
// default top-right. The default position got missed by users when
// the LithoForge inbox notification fired because the workspace's
// busy right rail (Inspector, Gallery button, Send to OrcaSlicer)
// drew the eye away from the corner. `position="top-center"` puts
// the toast directly in the user's reading path; `richColors` keeps
// success / warning / error icons obvious at a glance.
const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      position="top-center"
      richColors
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
