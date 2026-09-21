"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type ProductSearchInputProps = {
  query: string;
  onSearch: (query: string) => void;
};

export function ProductSearchInput({ query, onSearch }: ProductSearchInputProps) {
  const [draftQuery, setDraftQuery] = useState(query);

  useEffect(() => setDraftQuery(query), [query]);

  return (
    <form
      className="grid gap-1.5"
      aria-label="Product search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draftQuery);
      }}
    >
      <label htmlFor="admin-product-search" className="text-sm font-medium">
        Search
      </label>
      <Input
        id="admin-product-search"
        type="search"
        value={draftQuery}
        onChange={(event) => setDraftQuery(event.target.value)}
        placeholder="Search products"
      />
    </form>
  );
}
