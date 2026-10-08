import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zctniygnzneirsbewttw.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_9CVKkoyi-ivVHmOtk8hNEw_8wK8FnB2";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
