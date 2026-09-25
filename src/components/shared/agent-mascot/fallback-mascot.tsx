import { Bot } from "lucide-react";

interface MascotSvgProps {
  size: number;
}

export function FallbackMascot({ size }: MascotSvgProps) {
  return (
    <div
      className="fallback-icon"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Bot
        size={size * 0.7}
        strokeWidth={1.5}
        className="text-muted-foreground"
      />
    </div>
  );
}
