/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL for the remote student display (optional; can also be set in the app) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (or legacy anon) key: public, safe to ship */
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
