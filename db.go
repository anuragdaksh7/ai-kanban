package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver (no CGO required)
)

// openDB opens (and creates, if needed) the SQLite database, enables WAL and
// a busy timeout, and makes sure the schema exists.
func openDB(path string) (*sql.DB, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	// modernc.org/sqlite accepts pragma settings as DSN parameters.
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)", filepath.ToSlash(path))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}

	// SQLite is a single-writer database. One pooled connection serializes
	// writers so concurrent agent updates never trip SQLITE_BUSY.
	db.SetMaxOpenConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func migrate(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS tickets (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			content           TEXT NOT NULL DEFAULT '',
			agent             TEXT NOT NULL DEFAULT '',
			worktree          TEXT NOT NULL DEFAULT '',
			issue_number      INTEGER,
			pr_number         INTEGER,
			status            TEXT NOT NULL DEFAULT 'unstarted',
			decisions_pending TEXT NOT NULL DEFAULT '[]',
			tldr              TEXT NOT NULL DEFAULT '',
			metadata          TEXT NOT NULL DEFAULT '{}',
			session_code      TEXT NOT NULL DEFAULT '',
			created_at        TEXT NOT NULL,
			updated_at        TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets(status)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_agent       ON tickets(agent)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_worktree    ON tickets(worktree)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_issue       ON tickets(issue_number)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_pr          ON tickets(pr_number)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_session     ON tickets(session_code)`,
		`CREATE INDEX IF NOT EXISTS idx_tickets_updated_at  ON tickets(updated_at)`,
		`CREATE TABLE IF NOT EXISTS feedback (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			ticket_id  INTEGER,
			agent      TEXT NOT NULL DEFAULT '',
			audience   TEXT NOT NULL DEFAULT '',
			summary    TEXT NOT NULL DEFAULT '',
			content    TEXT NOT NULL DEFAULT '',
			rating     INTEGER,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_feedback_agent    ON feedback(agent)`,
		`CREATE INDEX IF NOT EXISTS idx_feedback_ticket  ON feedback(ticket_id)`,
		`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at)`,
	}
	for _, stmt := range stmts {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("exec %q: %w", firstWords(stmt, 4), err)
		}
	}
	// Existing databases predate the audience column; add it and classify the
	// legacy rows — all feedback submitted before the field existed was
	// agent-ergonomics commentary.
	if err := ensureFeedbackAudience(ctx, db); err != nil {
		return err
	}
	return nil
}

func ensureFeedbackAudience(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(feedback)`)
	if err != nil {
		return fmt.Errorf("pragma feedback: %w", err)
	}
	hasAudience := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("scan pragma feedback: %w", err)
		}
		if name == "audience" {
			hasAudience = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if !hasAudience {
		if _, err := db.ExecContext(ctx,
			`ALTER TABLE feedback ADD COLUMN audience TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add feedback.audience: %w", err)
		}
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE feedback SET audience = 'agent' WHERE audience = ''`); err != nil {
		return fmt.Errorf("backfill feedback.audience: %w", err)
	}
	return nil
}

func firstWords(s string, n int) string {
	out := ""
	for i, w := 0, 0; i < len(s) && w < n; i++ {
		if s[i] == ' ' || s[i] == '\t' || s[i] == '\n' {
			w++
			continue
		}
		start := i
		for i < len(s) && s[i] != ' ' && s[i] != '\t' && s[i] != '\n' {
			i++
		}
		out += s[start:i] + " "
		w++
	}
	return out
}
