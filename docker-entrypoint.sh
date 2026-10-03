#!/bin/sh
set -eu

node /app/scripts/check_database_connection.mjs

mkdir -p /app/storage

if [ -z "${APP_KEY:-}" ]; then
  APP_KEY="$(node --input-type=module -e '
    import { randomBytes } from "node:crypto"
    import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises"

    const storagePath = "/app/storage"
    const keyPath = `${storagePath}/.app_key`
    const temporaryPath = `${keyPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
    await mkdir(storagePath, { recursive: true })
    await writeFile(temporaryPath, `${randomBytes(32).toString("hex")}\n`, {
      flag: "wx",
      mode: 0o600,
    })

    try {
      await link(temporaryPath, keyPath)
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (error.code !== "ENOENT") throw error
      })
    }

    const key = (await readFile(keyPath, "utf8")).trim()
    if (!key) throw new Error("Persistent application key is empty")
    process.stdout.write(key)
  ')"
  export APP_KEY
fi

echo '[startup] Applying database migrations...'
node build/ace.js migration:run --force
echo '[startup] Seeding base data...'
node build/ace.js db:seed

exec "$@"
