CREATE TABLE quiz_results (id TEXT PRIMARY KEY NOT NULL, player TEXT NOT NULL CHECK(player IN ('hugo','iggy')), points INTEGER NOT NULL CHECK(points >= 0 AND points <= 10), created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE parent_settings (id INTEGER PRIMARY KEY NOT NULL CHECK(id=1), sats_per_point INTEGER NOT NULL DEFAULT 0, daily_limit INTEGER NOT NULL DEFAULT 0);
