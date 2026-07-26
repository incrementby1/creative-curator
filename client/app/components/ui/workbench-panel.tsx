import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type Props<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  elevated?: boolean;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

export function WorkbenchPanel<T extends ElementType = "section">({ as, children, className, elevated = false, ...props }: Props<T>) {
  const Component = as ?? "section";
  return <Component className={["workbench-panel", elevated && "workbench-panel--elevated", className].filter(Boolean).join(" ")} {...props}>{children}</Component>;
}
