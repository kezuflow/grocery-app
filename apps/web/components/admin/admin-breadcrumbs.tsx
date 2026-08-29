import Link from "next/link";

export function AdminBreadcrumbs({
  items,
}: {
  items: ReadonlyArray<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-[var(--fm-text-muted)]">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li className="flex items-center gap-2" key={`${item.label}-${index}`}>
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {!current && item.href ? (
                <Link className="underline" href={item.href}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={current ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
