import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // bottom-center: o container é recentralizado por CSS (ver .traje-toast em
      // index.css), mas a origem "bottom" preserva a animação de entrada nativa do
      // Sonner subindo suavemente a partir de baixo.
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: "traje-toast",
          success: "traje-toast-success",
          error: "traje-toast-error",
          info: "traje-toast-info",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
