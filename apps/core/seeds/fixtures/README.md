# Retained migration fixtures

`retained-0068.sql` freezes the development commerce graph used by the populated 0068 upgrade tests before cycle-goods tracking. It includes historical accepted receipts and stock evidence. Keep it compatible with that historical schema; current development seed changes belong in `../development.sql`.

The Node migration verifier and Worker/D1 upgrade test load this fixture before applying forward migrations. They compare retained records, receipt quantities, physical balances and ledger, and reject inferred cycle allocation. This is test data, never a command to reset a retained deployment.
