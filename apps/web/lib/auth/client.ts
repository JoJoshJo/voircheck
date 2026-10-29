'use client';

import { createAuthClient } from '@neondatabase/auth/next';

/** Browser-side Neon Auth client (social sign-in redirects). Server-side auth stays in ./server.ts. */
export const authClient = createAuthClient();
