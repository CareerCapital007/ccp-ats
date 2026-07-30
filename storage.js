import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = 'ccp_kv';

/**
 * Recreates the artifact storage API on top of Postgres.
 * Same method names, same return shapes, same throw-on-missing-key behaviour,
 * so ccp-ats.jsx runs unchanged.
 */
export function installStorage() {
  window.storage = {
    async get(key) {
      const { data, error } = await supabase.from(TABLE).select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`No record for ${key}`);
      return { key, value: data.value, shared: true };
    },

    async set(key, value) {
      const { error } = await supabase
        .from(TABLE)
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      return { key, value, shared: true };
    },

    async delete(key) {
      const { error } = await supabase.from(TABLE).delete().eq('key', key);
      if (error) throw error;
      return { key, deleted: true, shared: true };
    },

    async list(prefix = '') {
      const q = supabase.from(TABLE).select('key');
      const { data, error } = prefix ? await q.like('key', `${prefix}%`) : await q;
      if (error) throw error;
      return { keys: data.map((r) => r.key), prefix, shared: true };
    },
  };
}
