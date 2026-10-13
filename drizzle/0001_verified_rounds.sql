CREATE TABLE quiz_rounds (id TEXT PRIMARY KEY NOT NULL, player TEXT NOT NULL CHECK(player IN ('hugo','iggy')), cap INTEGER NOT NULL CHECK(cap IN (10,20,50,100)), mode TEXT NOT NULL CHECK(mode IN ('add','subtract','multiply','divide','mixed')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE quiz_questions (id TEXT PRIMARY KEY NOT NULL, round_id TEXT NOT NULL REFERENCES quiz_rounds(id), idx INTEGER NOT NULL CHECK(idx BETWEEN 0 AND 9), a INTEGER NOT NULL, b INTEGER NOT NULL, op TEXT NOT NULL, expected INTEGER NOT NULL, expires_at INTEGER NOT NULL, submitted INTEGER, is_correct INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0,1)), answered_at INTEGER, UNIQUE(round_id,idx));
--> statement-breakpoint
CREATE INDEX quiz_questions_round ON quiz_questions(round_id,answered_at);
