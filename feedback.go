package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
)

// Feedback is agent-submitted commentary about the platform itself: what
// could be improved in the API, the UI, or the overall workflow. It is
// append-only; agents are nudged to submit it right after they create a
// ticket or transition their ticket to "completed" (see requestFeedbackHint
// attached to those responses).
type Feedback struct {
	ID        int64  `json:"id"`
	TicketID  *int64 `json:"ticketId"` // optional link to the session's ticket
	Agent     string `json:"agent"`
	Summary   string `json:"summary"`
	Content   string `json:"content"`
	Rating    *int64 `json:"rating"` // optional 1-5
	CreatedAt string `json:"createdAt"`
}

// requestFeedbackHint is attached to ticket responses when it is a natural
// point in the agent's session to give feedback.
const requestFeedbackHint = "Kanban board suggestion: now is a good moment to submit feedback — POST /api/v1/feedback with {agent, summary, content, rating(1-5), ticketId} describing anything that could improve this platform (missing fields, API ergonomics, UI, workflow). Optional."

var feedbackFieldNames = []string{"agent", "summary", "content", "rating", "ticketId"}

// --- store ----------------------------------------------------------------

func (s *store) insertFeedback(ctx context.Context, f *Feedback) error {
	f.CreatedAt = nowRFC3339()
	var ticketID, rating any
	if f.TicketID != nil {
		ticketID = *f.TicketID
	}
	if f.Rating != nil {
		rating = *f.Rating
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO feedback (ticket_id, agent, summary, content, rating, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		ticketID, f.Agent, f.Summary, f.Content, rating, f.CreatedAt)
	if err != nil {
		return err
	}
	f.ID, err = res.LastInsertId()
	return err
}

func (s *store) listFeedback(ctx context.Context, agent string, ticket *int64, limit int) ([]Feedback, error) {
	var where []string
	var args []any
	if agent != "" {
		where = append(where, "agent = ?")
		args = append(args, agent)
	}
	if ticket != nil {
		where = append(where, "ticket_id = ?")
		args = append(args, *ticket)
	}
	query := "SELECT id, ticket_id, agent, summary, content, rating, created_at FROM feedback"
	if len(where) > 0 {
		query += " WHERE " + joinAND(where)
	}
	query += " ORDER BY created_at DESC, id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Feedback{}
	for rows.Next() {
		var f Feedback
		var ticketID, rating sql.NullInt64
		if err := rows.Scan(&f.ID, &ticketID, &f.Agent, &f.Summary, &f.Content, &rating, &f.CreatedAt); err != nil {
			return nil, err
		}
		if ticketID.Valid {
			f.TicketID = &ticketID.Int64
		}
		if rating.Valid {
			f.Rating = &rating.Int64
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func joinAND(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " AND "
		}
		out += p
	}
	return out
}

// --- handlers ---------------------------------------------------------------

// handleCreateFeedback implements POST /api/v1/feedback.
func (s *server) handleCreateFeedback(w http.ResponseWriter, r *http.Request) {
	fields, ok := readBodyFor(r, w, feedbackFieldNames)
	if !ok {
		return
	}
	f := &Feedback{}

	if err := setStringFields(fields, f, map[string]*string{
		"agent":   &f.Agent,
		"summary": &f.Summary,
		"content": &f.Content,
	}); err != nil {
		failJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if fields["rating"] != nil {
		v, ok, err := parseIntField("rating", fields["rating"])
		if err != nil {
			failJSON(w, http.StatusBadRequest, err.Error())
			return
		}
		if ok && (v < 1 || v > 5) {
			failJSON(w, http.StatusBadRequest, "field \"rating\" must be between 1 and 5")
			return
		}
		if ok {
			f.Rating = &v
		}
	}
	if fields["ticketId"] != nil {
		v, _, err := parseIntField("ticketId", fields["ticketId"])
		if err != nil {
			failJSON(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := s.st.getTicket(r.Context(), v); errors.Is(err, errNotFound) {
			failJSON(w, http.StatusBadRequest, fmt.Sprintf("ticket %d does not exist", v))
			return
		}
		f.TicketID = &v
	}

	if err := s.st.insertFeedback(r.Context(), f); err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// handleListFeedback implements GET /api/v1/feedback (?agent=&ticket=&limit=).
func (s *server) handleListFeedback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	agent := q.Get("agent")
	var ticket *int64
	if raw := q.Get("ticket"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			failJSON(w, http.StatusBadRequest, "ticket must be a positive integer")
			return
		}
		ticket = &v
	}
	limit := 200
	if raw := q.Get("limit"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 || v > 1000 {
			failJSON(w, http.StatusBadRequest, "limit must be an integer between 1 and 1000")
			return
		}
		limit = v
	}

	feedback, err := s.st.listFeedback(r.Context(), agent, ticket, limit)
	if err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"feedback": feedback, "count": len(feedback)})
}

// --- shared body helpers (ticket + feedback) --------------------------------

// readBodyFor decodes the request body as a JSON object and rejects unknown
// top-level fields with a helpful error.
func readBodyFor(r *http.Request, w http.ResponseWriter, allowed []string) (map[string]json.RawMessage, bool) {
	fields, ok := readBody(r, w)
	if !ok {
		return nil, false
	}
	var unknown []string
	known := make(map[string]bool, len(allowed))
	for _, f := range allowed {
		known[f] = true
	}
	for k := range fields {
		if !known[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		failJSON(w, http.StatusBadRequest,
			fmt.Sprintf("unknown field %q; allowed fields: %s", unknown[0], joinStrings(allowed)))
		return nil, false
	}
	return fields, true
}

func setStringFields(fields map[string]json.RawMessage, dst any, targets map[string]*string) error {
	for key, target := range targets {
		if fields[key] == nil {
			continue
		}
		v, _, err := parseStringField(key, fields[key])
		if err != nil {
			return err
		}
		*target = v
	}
	return nil
}

func joinStrings(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
