export function IconCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      aria-hidden="true"
      className="absolute -top-2.5 -right-2.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--fm-primary-dark)] px-1 py-0.5 text-[10px] font-semibold leading-none text-white"
    >
      {count}
    </span>
  );
}
