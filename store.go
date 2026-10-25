package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var errNotFound = errors.New("ticket not found")

type store struct{ db *sql.DB }

// ticketFilter describes the filters a listing supports.
type ticketFilter struct {
	statuses      []string // exact status set; empty = any
	agent         string   // exact match
	worktreeTerm  string   // substring match
	worktreeExact string   // exact match (used by find-or-create)
	issue         *int64
	pr            *int64
	session       string // exact session code
	q             string // free-text search
}

const ticketCols = "id, content, agent, worktree, issue_number, pr_number, status, decisions_pending, tldr, metadata, session_code, created_at, updated_at"

// listTickets returns all matching tickets, newest activity first.
func (s *store) listTickets(ctx context.Context, f ticketFilter) ([]Ticket, error) {
	var where []string
	var args []any

	if len(f.statuses) > 0 {
		ph := make([]string, len(f.statuses))
		for i, st := range f.statuses {
			ph[i] = "?"
			args = append(args, st)
		}
		where = append(where, "status IN ("+strings.Join(ph, ",")+")")
	}
	if f.agent != "" {
		where = append(where, "agent = ?")
		args = append(args, f.agent)
	}
	if f.worktreeExact != "" {
		where = append(where, "worktree = ?")
		args = append(args, f.worktreeExact)
	}
	if f.worktreeTerm != "" {
		where = append(where, "worktree LIKE ?")
		args = append(args, "%"+f.worktreeTerm+"%")
	}
	if f.issue != nil {
		where = append(where, "issue_number = ?")
		args = append(args, *f.issue)
	}
	if f.pr != nil {
		where = append(where, "pr_number = ?")
		args = append(args, *f.pr)
	}
	if f.session != "" {
		where = append(where, "session_code = ?")
		args = append(args, f.session)
	}
	if f.q != "" {
		where = append(where, "(content LIKE ? OR tldr LIKE ? OR agent LIKE ? OR worktree LIKE ? OR session_code LIKE ?)")
		like := "%" + f.q + "%"
		args = append(args, like, like, like, like, like)
	}

	query := "SELECT " + ticketCols + " FROM tickets"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY updated_at DESC, id DESC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Ticket
	for rows.Next() {
		t, err := scanTicket(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (s *store) getTicket(ctx context.Context, id int64) (*Ticket, error) {
	row := s.db.QueryRowContext(ctx, "SELECT "+ticketCols+" FROM tickets WHERE id = ?", id)
	t, err := scanTicket(row)
	if err != nil {
		return nil, err
	}
	return normalizeTicket(t), nil
}

func (s *store) insertTicket(ctx context.Context, t *Ticket) error {
	t.CreatedAt = nowRFC3339()
	t.UpdatedAt = t.CreatedAt

	var issue, pr any
	if t.IssueNumber != nil {
		issue = *t.IssueNumber
	}
	if t.PRNumber != nil {
		pr = *t.PRNumber
	}

	res, err := s.db.ExecContext(ctx, `INSERT INTO tickets
		(content, agent, worktree, issue_number, pr_number, status, decisions_pending, tldr, metadata, session_code, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.Content, t.Agent, t.Worktree, issue, pr, t.Status,
		mustJSON(t.DecisionsPending), t.TLDR, mustJSON(t.Metadata), t.SessionCode,
		t.CreatedAt, t.UpdatedAt,
	)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	t.ID = id
	return nil
}

// updateTicketColumns applies a validated set of column updates and returns
// the fresh ticket.
func (s *store) updateTicketColumns(ctx context.Context, id int64, set map[string]any) (*Ticket, error) {
	if len(set) > 0 {
		set["updated_at"] = nowRFC3339()

		cols := make([]string, 0, len(set))
		args := make([]any, 0, len(set)+1)
		for _, col := range dbColumns {
			if v, ok := set[col]; ok {
				cols = append(cols, col+" = ?")
				args = append(args, v)
			}
		}
		args = append(args, id)

		res, err := s.db.ExecContext(ctx,
			"UPDATE tickets SET "+strings.Join(cols, ", ")+" WHERE id = ?", args...)
		if err != nil {
			return nil, err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return nil, err
		}
		if affected == 0 {
			return nil, errNotFound
		}
	}
	return s.getTicket(ctx, id)
}

func (s *store) countTickets(ctx context.Context) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM tickets").Scan(&n)
	return n, err
}

// --- scanning -------------------------------------------------------------

// dbColumns are the only columns updateTicketColumns may ever be called with;
// handlers build them from a fixed whitelist, this is a second guard.
var dbColumns = []string{
	"content", "agent", "worktree", "issue_number", "pr_number", "status",
	"decisions_pending", "tldr", "metadata", "session_code", "created_at", "updated_at",
}

// rowScan works for both *sql.Row and *sql.Rows.
type rowScan interface {
	Scan(dest ...any) error
}

func scanTicket(row rowScan) (*Ticket, error) {
	t := &Ticket{}
	var issue, pr sql.NullInt64
	var decisionsJSON, metadataJSON string

	err := row.Scan(&t.ID, &t.Content, &t.Agent, &t.Worktree, &issue, &pr, &t.Status,
		&decisionsJSON, &t.TLDR, &metadataJSON, &t.SessionCode, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	if issue.Valid {
		t.IssueNumber = &issue.Int64
	}
	if pr.Valid {
		t.PRNumber = &pr.Int64
	}

	// Numbers are kept as json.Number so the JSON output preserves every
	// integer the agent originally sent.
	if strings.TrimSpace(decisionsJSON) != "" {
		dec := json.NewDecoder(strings.NewReader(decisionsJSON))
		if err := dec.Decode(&t.DecisionsPending); err != nil {
			return nil, fmt.Errorf("corrupt decisions_pending for ticket %d: %w", t.ID, err)
		}
	}
	if strings.TrimSpace(metadataJSON) != "" {
		dec := json.NewDecoder(strings.NewReader(metadataJSON))
		dec.UseNumber()
		if err := dec.Decode(&t.Metadata); err != nil {
			return nil, fmt.Errorf("corrupt metadata for ticket %d: %w", t.ID, err)
		}
	}
	return t, nil
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}
