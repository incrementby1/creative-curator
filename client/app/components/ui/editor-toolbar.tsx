import type { HTMLAttributes } from "react";

export function EditorToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["editor-toolbar", className].filter(Boolean).join(" ")} role="toolbar" {...props} />;
}
