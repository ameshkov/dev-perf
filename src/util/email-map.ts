/**
 * Shared email-to-name mapping for identity merging: the config
 * `users-map` key maps author emails to display names so identities
 * that would otherwise stay separate merge into one (results are united
 * under the display name). The mapping keys are lowercased emails; the
 * values are the display names identities merge under.
 */
import { z } from 'zod';

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
 * Compiles the email mappings from the parsed `email=name` entries;
 * on a conflict the later entry wins.
 *
 * @param maps - The parsed `email=name` entries.
 * @returns The compiled email-to-name mapping.
 */
export function loadEmailMap(maps: EmailMapEntry[] = []): EmailMap {
  const emailMap: EmailMap = {};
  for (const entry of maps) {
    emailMap[entry.email] = entry.name;
  }
  return emailMap;
}

/**
 * Parses the `users-map` config key (an email-to-display-name YAML
 * mapping) into parsed mapping entries, so structured names pass
 * through verbatim: a comma inside a display name stays part of the
 * name instead of being re-split. The email side is trimmed and
 * lowercased like the mapping normalization does, so the config value
 * canonicalizes like an `email=name` entry would.
 *
 * @param usersMap - The config `users-map` record: email to display name.
 * @returns The parsed mapping entries.
 * @throws {Error} When an entry has an empty email or name; the
 * config-file schema already rejects these, so this guards against a
 * caller bypassing it.
 */
export function usersMapToEntries(usersMap: Record<string, string>): EmailMapEntry[] {
  const entries: EmailMapEntry[] = [];
  for (const [email, name] of Object.entries(usersMap)) {
    // The email side comes from `Object.entries`, so it is always a
    // string; only the name can arrive as a non-string value (e.g. a
    // numeric YAML value that bypassed the config-file schema), whose
    // `.trim` would otherwise throw a raw `.trim is not a function`
    // TypeError; reject it with the friendly error this function
    // documents instead.
    if (typeof name !== 'string') {
      throw new Error(
        `Invalid options:\nusers-map: expected a non-empty email and name, got '${String(email)}' -> '${String(name)}'`,
      );
    }
    const parsed = emailMapEntrySchema.safeParse({
      email: email.trim().toLowerCase(),
      name: name.trim(),
    });
    if (!parsed.success) {
      throw new Error(
        `Invalid options:\nusers-map: expected a non-empty email and name, got '${email}' -> '${name}'`,
      );
    }
    entries.push(parsed.data);
  }
  return entries;
}
