// Supabase project the matrix syncs to (Inbox project). The publishable key is safe to ship:
// row-level security limits every request to the signed-in user's own rows.
window.MATRIX_CONFIG = {
  supabaseUrl: 'https://qaabxgldjluqyccwhjzf.supabase.co',
  supabaseKey: 'sb_publishable_174ADmpQYYVspwAiMCL_ig_sAxe5ymU',
  table: 'matrix_tasks',
  appName: 'Airlock',
  privacyUrl: 'https://airlock.neworbitdigital.com/privacy',
};
