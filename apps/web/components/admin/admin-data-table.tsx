import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type AdminDataTableColumn<Row> = {
  key: string;
  header: string;
  render(row: Row): ReactNode;
  className?: string;
};

/** Typed, keyboard-scrollable Admin table with compact mobile row labels. */
export function AdminDataTable<Row>({
  ariaLabel,
  columns,
  rows,
  rowKey,
}: {
  ariaLabel: string;
  columns: ReadonlyArray<AdminDataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey(row: Row): string;
}) {
  return (
    <Table aria-label={ariaLabel}>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead className={column.className} key={column.key}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell className={column.className} data-label={column.header} key={column.key}>
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
