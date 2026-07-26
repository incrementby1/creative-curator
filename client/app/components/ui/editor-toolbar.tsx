import type { HTMLAttributes } from "react";

export function EditorToolbar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={["editor-toolbar", className].filter(Boolean).join(" ")} role="toolbar" {...props} />;
}
