type Props = {
  href?: string;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
  children: unknown;
  id?: string;
  disabled?: boolean;
  onClick?: string;
};

export function Button({ href, variant = "primary", children, id, disabled, type = "button", onClick }: Props) {
  const cls = `btn btn-${variant}`;
  if (href) return <a class={cls} href={href} id={id}>{children}</a>;
  return (
    <button class={cls} type={type} id={id} disabled={disabled} onclick={onClick}>
      {children}
    </button>
  );
}
