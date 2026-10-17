import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { storageSchema } from './storage-schema.mjs';

// Local PostgreSQL only. No hosted connection or environment credentials.
// Older release-audit/recovery tests intentionally exercise the 004/005 snapshot.
// Feature tests can explicitly opt into later numbered migrations.
export async function releaseDatabase({ release = true, throughMigration = release ? 5 : 4 } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (instance_id uuid, id uuid primary key, aud text, role text,
      email text, encrypted_password text, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean,
      created_at timestamptz, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable set search_path = ''
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create publication supabase_realtime;
  `);
  if (throughMigration >= 9) await db.exec(storageSchema);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).sort()) {
    if (!file.endsWith('.sql') || Number(file.slice(0, 3)) > throughMigration) continue;
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  await db.exec(await readFile(new URL('../../supabase/seed.sql', import.meta.url), 'utf8'));
  return db;
}
