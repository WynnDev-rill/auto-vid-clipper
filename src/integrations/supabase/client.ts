import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  CLIPFORGE_SUPABASE_PUBLISHABLE_KEY,
  CLIPFORGE_SUPABASE_URL,
} from './config';

export const supabase = createClient<Database>(
  CLIPFORGE_SUPABASE_URL,
  CLIPFORGE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      flowType: 'pkce',
      detectSessionInUrl: false,
    },
  },
);
