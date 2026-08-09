import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  CLIPFORGE_SUPABASE_PUBLISHABLE_KEY,
  CLIPFORGE_SUPABASE_URL,
} from './config';

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request?.headers) throw new Error('Unauthorized: No request headers available');

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Bearer token required');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || token.split('.').length !== 3) {
      throw new Error('Unauthorized: Invalid token');
    }

    const supabase = createClient<Database>(
      CLIPFORGE_SUPABASE_URL,
      CLIPFORGE_SUPABASE_PUBLISHABLE_KEY,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) throw new Error('Unauthorized: Invalid token');

    return next({
      context: {
        supabase,
        userId: data.claims.sub,
        claims: data.claims,
      },
    });
  },
);
