import { randomUUID } from 'node:crypto'

const tables = [
  'users',
  'settings',
  'platforms',
  'architectures',
  'storage_providers',
  'software',
  'versions',
  'artifacts',
  'download_histories',
  'licenses',
  'license_activations',
  'storage_upload_reservations',
]
const skipped = [
  'sessions',
  'password_reset_tokens',
  'remember_me_tokens',
  'auth_rate_limits',
  'adonis_schema',
  'adonis_schema_versions',
]

/** Import only into an empty, migrated target; all data changes are transactional. */
export async function importLegacyData(client, document, { dryRun = false } = {}) {
  if (
    document.formatVersion !== 1 ||
    !document.tables ||
    typeof document.tables !== 'object' ||
    Array.isArray(document.tables)
  ) {
    throw new Error(
      'Expected formatVersion=1 and a tables object containing arrays of exported rows.'
    )
  }
  for (const [name, rows] of Object.entries(document.tables)) {
    if (![...tables, ...skipped].includes(name) || !Array.isArray(rows))
      throw new Error(`Unsupported table or row list: ${name}.`)
  }

  await client.query('BEGIN')
  try {
    await client.query(
      `LOCK TABLE ${[...tables, ...skipped.filter((table) => !table.startsWith('adonis_'))].map((name) => `"${name}"`).join(',')} IN ACCESS EXCLUSIVE MODE`
    )
    for (const table of [...tables, ...skipped.filter((name) => !name.startsWith('adonis_'))]) {
      const result = await client.query(`SELECT count(*) FROM "${table}"`)
      const count = Number(result.rows[0].count)
      if (table === 'software') {
        if (
          count > 1 ||
          (count === 1 &&
            !(await client.query("SELECT id FROM software WHERE slug='reeva' AND is_default=true"))
              .rowCount)
        ) {
          throw new Error('Target software table is not the migration-created baseline.')
        }
      } else if (count !== 0)
        throw new Error(`Target table ${table} is not empty; refusing to replace data.`)
    }

    const data = structuredClone(document.tables)
    if (!data.software?.length) {
      const setting = data.settings?.find((row) => row.key === 'appName')
      data.software = [
        {
          id: randomUUID(),
          name: String(setting?.value || 'Reeva').slice(0, 120),
          slug: 'reeva',
          is_active: true,
          is_default: true,
        },
      ]
      for (const row of data.versions || []) row.software_id = data.software[0].id
    }
    await client.query('DELETE FROM software')
    const counts = {}
    for (const table of tables) {
      const metadata = (
        await client.query(
          'SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
          [table]
        )
      ).rows
      const columns = new Map(metadata.map((column) => [column.column_name, column.data_type]))
      const rows = data[table] || []
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
          throw new Error(`Invalid row in ${table}.`)
        if (table === 'versions') delete row.version_number
        if (table === 'users') row.auth_version = Number(row.auth_version || 0) + 1
        for (const [column, value] of Object.entries(row)) {
          if (!columns.has(column)) throw new Error(`Unknown column ${table}.${column}.`)
          if (columns.get(column) === 'boolean' && value !== null) {
            if (![true, false, 0, 1, '0', '1'].includes(value))
              throw new Error(`Invalid boolean in ${table}.${column}.`)
            row[column] = value === true || value === 1 || value === '1'
          }
          if (columns.get(column) === 'jsonb' && typeof value === 'string')
            row[column] = JSON.parse(value)
          if (
            columns.get(column) === 'bigint' &&
            typeof value === 'number' &&
            !Number.isSafeInteger(value)
          ) {
            throw new Error(
              `Unsafe numeric value in ${table}.${column}; export bigint values as decimal strings.`
            )
          }
        }
        const names = Object.keys(row)
        if (!names.length) throw new Error(`Empty row in ${table}.`)
        await client.query(
          `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(',')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(',')})`,
          names.map((name) => row[name])
        )
      }
      counts[table] = rows.length
    }
    const defaultProduct = await client.query(
      'SELECT id FROM software WHERE is_default=true AND is_active=true'
    )
    if (defaultProduct.rowCount !== 1)
      throw new Error('Exactly one active default software must be supplied.')
    for (const [table, count] of Object.entries(counts)) {
      if (Number((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count) !== count)
        throw new Error(`Imported count mismatch for ${table}.`)
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    return { dryRun, counts, authenticationTokensImported: false, userAuthVersionsAdvanced: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
