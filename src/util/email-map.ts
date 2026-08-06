/**
 * Shared email-to-name mapping for identity merging: the `report`
 * (`--map`/`--maps-file`) and `compile` (`DEV_PERF_COMPILE_MAP`) commands
 * both map author emails to display names so identities that would
 * otherwise stay separate merge into one. The mapping keys are lowercased
 * emails; the values are the display names identities merge under.
 */
import { z } from 'zod';
import { readJsonFile } from './json.js';

/** Compiled email mappings: lowercased email to display name. */
export type EmailMap = Record<string, string>;

/**
 * One parsed `email=name` mapping entry: the lowercased email and the
 * display name it maps to.
 */
export type EmailMapEntry = z.infer<typeof emailMapEntrySchema>;

/**
 * zod schema for one parsed `email=name` mapping entry: a non-empty
 * lowercased email and a non-empty display name.
 */
export const emailMapEntrySchema = z.object({
  /** Lowercased author email. */
  email: z.string().min(1),
  /** Display name the email is mapped to. */
  name: z.string().min(1),
});

/**
 * JSON shape of an `--maps-file`: a flat email-to-name object. The
 * loader trims the keys and values and rejects any that become empty,
 * so empty/blank entries are caught by the clearer
 * `"email" and "Name" must be non-empty` error rather than by the
 * shape check here.
 */
const mapsFileSchema = z.record(z.string(), z.string());

/**
 * Parses one `email=name` mapping entry, lowercasing the email side.
 *
 * @param entry - The raw `email=name` text.
 * @param source - Where the entry came from, for error messages.
 * @returns The parsed mapping entry.
 * @throws {Error} When the entry is not a `email=name` pair with
 * non-empty sides.
 */
export function parseEmailMapEntry(entry: string, source: string): EmailMapEntry {
  const separator = entry.indexOf('=');
  const email = separator === -1 ? '' : entry.slice(0, separator).trim().toLowerCase();
  const name = separator === -1 ? '' : entry.slice(separator + 1).trim();
  if (email === '' || name === '') {
    throw new Error(`Invalid options:\n${source}: expected 'email=name', got '${entry}'`);
  }
  return { email, name };
}

/**
 * Compiles the email mappings: the `--maps-file` entries merged with the
 * `--map` entries, with the `--map` entries winning on conflict (the flag
 * wins over the file, mirroring the env resolution).
 *
 * @param mapsFile - The `--maps-file` path, if any.
 * @param maps - The parsed `--map` entries.
 * @returns The compiled email-to-name mapping.
 * @throws {Error} When the maps file is missing, not a flat
 * email-to-name object, or holds a key or name that is empty/blank.
 */
export async function loadEmailMap(
  mapsFile: string | undefined,
  maps: EmailMapEntry[] = [],
): Promise<EmailMap> {
  const emailMap: EmailMap = {};
  if (mapsFile !== undefined && mapsFile.trim() !== '') {
    const raw = await readJsonFile(mapsFile);
    const result = mapsFileSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Invalid maps file (${mapsFile}): expected an object of { "email": "Name" } entries`,
      );
    }
    for (const [email, name] of Object.entries(result.data)) {
      const key = email.trim().toLowerCase();
      const value = name.trim();
      if (key === '' || value === '') {
        throw new Error(`Invalid maps file (${mapsFile}): "email" and "Name" must be non-empty`);
      }
      emailMap[key] = value;
    }
  }
  for (const entry of maps) {
    emailMap[entry.email] = entry.name;
  }
  return emailMap;
}
