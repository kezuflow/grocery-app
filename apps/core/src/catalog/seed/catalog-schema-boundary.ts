/** Select the schema history owned by a generated migration, excluding itself and later phases. */
export function selectCatalogSchemaMigrations(
  migrationNames: readonly string[],
  generatedMigrationName: string,
): string[] {
  return migrationNames
    .filter((name) => name.endsWith(".sql") && name < generatedMigrationName)
    .sort();
}
