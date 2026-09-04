import { createClient } from "@supabase/supabase-js";

// Данные проекта Supabase.
const SUPABASE_URL = "https://fdnarcnqfbksnkasfvnk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkbmFyY25xZmJrc25rYXNmdm5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MTM2MTEsImV4cCI6MjEwMzk4OTYxMX0.A7vaDi0Dw7VbvYxI7rh-_zSOI0DuNw5-O-LSxARUxaE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
