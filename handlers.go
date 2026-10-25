package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

const maxBodyBytes = 1 << 20 // 1 MiB

type server struct{ st *store }

func newServer(db *sql.DB) *server { return &server{st: &store{db: db}} }

func registerAPI(mux *http.ServeMux, s *server) {
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)

	mux.HandleFunc("GET /api/v1/tickets", s.handleListTickets)
	mux.HandleFunc("POST /api/v1/tickets", s.handleCreateTicket)
	mux.HandleFunc("POST /api/v1/tickets/ensure", s.handleEnsureTicket)

	mux.HandleFunc("GET /api/v1/tickets/{id}", s.handleGetTicket)
	mux.HandleFunc("PATCH /api/v1/tickets/{id}", s.handleUpdateTicket)
	mux.HandleFunc("PUT /api/v1/tickets/{id}", s.handleUpdateTicket) // alias, agents use both

	mux.HandleFunc("POST /api/v1/tickets/{id}/finish", s.handleFinishTicket) // user-only action

	mux.HandleFunc("POST /api/v1/feedback", s.handleCreateFeedback)
	mux.HandleFunc("GET /api/v1/feedback", s.handleListFeedback)
}

// --- helpers --------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ") // easy to read when agents print curl output
	_ = enc.Encode(v)
}

func failJSON(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// readBody decodes the request body into a JSON object, size-limited.
// Endpoint-specific handlers enforce their own field whitelist via readBodyFor.
func readBody(r *http.Request, w http.ResponseWriter) (map[string]json.RawMessage, bool) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	var fields map[string]json.RawMessage
	if err := dec.Decode(&fields); err != nil {
		failJSON(w, http.StatusBadRequest, "body must be a JSON object: "+err.Error())
		return nil, false
	}
	return fields, true
}

func unknownFields(fields map[string]json.RawMessage, allowed []string) []string {
	ok := make(map[string]bool, len(allowed))
	for _, f := range allowed {
		ok[f] = true
	}
	var unknown []string
	for k := range fields {
		if !ok[k] {
			unknown = append(unknown, k)
		}
	}
	return unknown
}

var ticketFieldNames = []string{
	"content", "agent", "worktree", "issueNumber", "prNumber", "status",
	"decisionsPending", "tldr", "metadata", "sessionCode",
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

func ticketNotFound(w http.ResponseWriter) {
	failJSON(w, http.StatusNotFound, "ticket not found")
}

// decodeTicketFields builds a Ticket from a raw create/ensure body using the
// same semantics as PATCH (absent = default, null = zero value).
func decodeTicketFields(fields map[string]json.RawMessage, t *Ticket) error {
	setString := func(key string, dst *string) error {
		if fields[key] == nil {
			return nil
		}
		v, _, err := parseStringField(key, fields[key])
		if err != nil {
			return err
		}
		*dst = v
		return nil
	}
	for _, err := range []error{
		setString("content", &t.Content),
		setString("agent", &t.Agent),
		setString("worktree", &t.Worktree),
		setString("tldr", &t.TLDR),
		setString("sessionCode", &t.SessionCode),
	} {
		if err != nil {
			return err
		}
	}
	if fields["issueNumber"] != nil {
		v, ok, err := parseIntField("issueNumber", fields["issueNumber"])
		if err != nil {
			return err
		}
		if ok {
			t.IssueNumber = &v
		}
	}
	if fields["prNumber"] != nil {
		v, ok, err := parseIntField("prNumber", fields["prNumber"])
		if err != nil {
			return err
		}
		if ok {
			t.PRNumber = &v
		}
	}
	if fields["status"] != nil {
		status, _, err := parseStatusField(fields["status"])
		if err != nil {
			return err
		}
		if status == StatusFinished {
			return fmt.Errorf("status %q is user-only; create the ticket first, then POST /api/v1/tickets/{id}/finish", StatusFinished)
		}
		t.Status = status
	}
	if fields["decisionsPending"] != nil {
		decisions, err := parseDecisionsPending(fields["decisionsPending"])
		if err != nil {
			return err
		}
		t.DecisionsPending = decisions
	}
	if fields["metadata"] != nil && string(fields["metadata"]) != "null" {
		// Decode with UseNumber so integers survive the storage round-trip.
		dec := json.NewDecoder(strings.NewReader(string(fields["metadata"])))
		dec.UseNumber()
		var decoded map[string]any
		if err := dec.Decode(&decoded); err != nil || decoded == nil {
			return errors.New(`field "metadata" must be a JSON object`)
		}
		for k, v := range decoded {
			if v == nil {
				delete(decoded, k) // a top-level null metadata value is meaningless on create
			}
		}
		t.Metadata = decoded
	}
	if t.Metadata == nil {
		t.Metadata = map[string]any{}
	}
	return nil
}

// --- handlers ---------------------------------------------------------------

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	n, err := s.st.countTickets(r.Context())
	if err != nil {
		failJSON(w, http.StatusInternalServerError, "database unavailable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "tickets": n})
}

func (s *server) handleListTickets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := ticketFilter{q: q.Get("q")}

	if raw := q.Get("status"); raw != "" {
		for _, st := range strings.Split(raw, ",") {
			st = strings.TrimSpace(st)
			if !validTicketStatus(st) {
				failJSON(w, http.StatusBadRequest,
					fmt.Sprintf("unknown status %q; valid: %s", st, strings.Join(statusOrder, ", ")))
				return
			}
			f.statuses = append(f.statuses, st)
		}
	}
	f.agent = q.Get("agent")
	f.worktreeTerm = q.Get("worktree")
	if raw := q.Get("issue"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			failJSON(w, http.StatusBadRequest, "issue must be a positive integer")
			return
		}
		f.issue = &v
	}
	if raw := q.Get("pr"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			failJSON(w, http.StatusBadRequest, "pr must be a positive integer")
			return
		}
		f.pr = &v
	}
	if raw := q.Get("session"); raw != "" {
		f.session = raw
	}

	tickets, err := s.st.listTickets(r.Context(), f)
	if err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tickets == nil {
		tickets = []Ticket{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tickets": tickets, "count": len(tickets)})
}

func (s *server) handleGetTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		failJSON(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	t, err := s.st.getTicket(r.Context(), id)
	if errors.Is(err, errNotFound) {
		ticketNotFound(w)
		return
	}
	if err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// hintTicket wraps a Ticket response with an optional agent nudge (e.g. to
// submit platform feedback after creating a ticket or completing work).
// The extra key is omitted entirely for ordinary responses.
type hintTicket struct {
	Ticket
	RequestFeedback string `json:"requestFeedback,omitempty"`
}

func ticketResponse(t *Ticket, hint bool) any {
	if !hint {
		return t
	}
	return hintTicket{Ticket: *t, RequestFeedback: requestFeedbackHint}
}

func (s *server) handleCreateTicket(w http.ResponseWriter, r *http.Request) {
	fields, ok := readBodyFor(r, w, ticketFieldNames)
	if !ok {
		return
	}
	t := &Ticket{Status: StatusUnstarted}
	if err := decodeTicketFields(fields, t); err != nil {
		failJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	t = normalizeTicket(t)
	if err := s.st.insertTicket(r.Context(), t); err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	// A fresh ticket is the first natural feedback point for agents.
	writeJSON(w, http.StatusCreated, ticketResponse(t, true))
}

// handleEnsureTicket implements the agent session flow: "pick up my ticket if
// one already exists for this issue/worktree and is not finished, otherwise
// create it". Matching prefers the issue number, falls back to the worktree.
// Response: 201 + ticket when created, 200 + ticket when found.
func (s *server) handleEnsureTicket(w http.ResponseWriter, r *http.Request) {
	fields, ok := readBodyFor(r, w, ticketFieldNames)
	if !ok {
		return
	}
	want := &Ticket{Status: StatusUnstarted}
	if err := decodeTicketFields(fields, want); err != nil {
		failJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	open := ticketFilter{statuses: openStatuses}

	if want.IssueNumber != nil {
		open.issue = want.IssueNumber
		if tickets, err := s.st.listTickets(r.Context(), open); err != nil {
			failJSON(w, http.StatusInternalServerError, err.Error())
			return
		} else if len(tickets) > 0 {
			writeJSON(w, http.StatusOK, tickets[0])
			return
		}
	}
	if want.Worktree != "" {
		open.worktreeExact = want.Worktree
		if tickets, err := s.st.listTickets(r.Context(), open); err != nil {
			failJSON(w, http.StatusInternalServerError, err.Error())
			return
		} else if len(tickets) > 0 {
			writeJSON(w, http.StatusOK, tickets[0])
			return
		}
	}

	if err := s.st.insertTicket(r.Context(), normalizeTicket(want)); err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Same hint as handleCreateTicket: this response means we CREATED one.
	writeJSON(w, http.StatusCreated, ticketResponse(want, true))
}

func (s *server) handleUpdateTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		failJSON(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	fields, ok := readBodyFor(r, w, ticketFieldNames)
	if !ok {
		return
	}

	current, err := s.st.getTicket(r.Context(), id)
	if errors.Is(err, errNotFound) {
		ticketNotFound(w)
		return
	}
	if err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}

	set, err := applyTicketPatch(current, fields)
	if err != nil {
		failJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, err := s.st.updateTicketColumns(r.Context(), id, set)
	if errors.Is(err, errNotFound) {
		ticketNotFound(w)
		return
	}
	if err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The second natural feedback point: the agent just declared its work
	// complete (transition to "completed", not a repeat PATCH).
	hint := updated.Status == StatusCompleted &&
		updated.Status != current.Status &&
		set["status"] == StatusCompleted
	writeJSON(w, http.StatusOK, ticketResponse(updated, hint))
}

// handleFinishTicket is the user-only action: put a ticket into "finished".
// It is reachable from the UI (drag to the Finished column or the Finish
// button) or via curl. Idempotent: finishing a finished ticket is a no-op.
func (s *server) handleFinishTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		failJSON(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	updated, err := s.st.updateTicketColumns(r.Context(), id, map[string]any{"status": StatusFinished})
	if errors.Is(err, errNotFound) {
		ticketNotFound(w)
		return
	}
	if err != nil {
		failJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
