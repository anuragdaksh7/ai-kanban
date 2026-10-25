package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Ticket statuses. "finished" is user-only: agents cannot set it through a
// normal update; it is set through POST /api/v1/tickets/{id}/finish (or the
// UI, which calls that endpoint).
const (
	StatusUnstarted = "unstarted"
	StatusStarted   = "started"
	StatusStopped   = "stopped"
	StatusCompleted = "completed"
	StatusFinished  = "finished"
)

var statusOrder = []string{StatusUnstarted, StatusStarted, StatusStopped, StatusCompleted, StatusFinished}

var validStatuses = map[string]bool{
	StatusUnstarted: true,
	StatusStarted:   true,
	StatusStopped:   true,
	StatusCompleted: true,
	StatusFinished:  true,
}

// openStatuses are the statuses agents may legitimately work with ("finished"
// is excluded because it is user-only).
var openStatuses = []string{StatusUnstarted, StatusStarted, StatusStopped, StatusCompleted}

func validTicketStatus(s string) bool { return validStatuses[s] }

// Ticket is the persisted representation of one agent session.
type Ticket struct {
	ID               int64          `json:"id"`
	Content          string         `json:"content"`   // the agent's report / notes for the session
	Agent            string         `json:"agent"`     // e.g. "claude", "codex", "goose"
	Worktree         string         `json:"worktree"`  // path of the worktree the agent worked in
	IssueNumber      *int64         `json:"issueNumber"`
	PRNumber         *int64         `json:"prNumber"`
	Status           string         `json:"status"`
	DecisionsPending []string       `json:"decisionsPending"` // decisions awaiting the user
	TLDR             string         `json:"tldr"`
	Metadata         map[string]any `json:"metadata"` // arbitrary JSON, agent-dictated
	SessionCode      string         `json:"sessionCode"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
}

// normalizeTicket guarantees non-nil slices/maps so JSON consumers always see
// objects/arrays instead of null.
func normalizeTicket(t *Ticket) *Ticket {
	if t.DecisionsPending == nil {
		t.DecisionsPending = []string{}
	}
	if t.Metadata == nil {
		t.Metadata = map[string]any{}
	}
	return t
}

func nowRFC3339() string {
	return time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
}

// --- body parsing helpers -------------------------------------------------

// parseStringField parses a field that must be a string (or null).
// Returns (value, sawNull, error). sawNull==true means the field was
// explicitly null.
func parseStringField(name string, raw json.RawMessage) (string, bool, error) {
	if raw == nil {
		return "", false, nil
	}
	if string(raw) == "null" {
		return "", true, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false, fmt.Errorf("field %q must be a string", name)
	}
	return s, false, nil
}

// parseIntField parses a field that must be a positive int64 (or null).
// ok==false with nil error means the field is absent/cleared.
func parseIntField(name string, raw json.RawMessage) (int64, bool, error) {
	if raw == nil || string(raw) == "null" {
		return 0, false, nil
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, false, fmt.Errorf("field %q must be an integer", name)
	}
	if n <= 0 {
		return 0, false, fmt.Errorf("field %q must be a positive integer", name)
	}
	return n, true, nil
}

// parseStatusField validates a status field (or null).
func parseStatusField(raw json.RawMessage) (string, bool, error) {
	if raw == nil || string(raw) == "null" {
		return "", false, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false, errors.New(`field "status" must be a string`)
	}
	if !validTicketStatus(s) {
		return "", false, fmt.Errorf("unknown status %q; valid: %s", s, strings.Join(statusOrder, ", "))
	}
	return s, true, nil
}

// parseDecisionsPending parses the decisionsPending field.
// Accepts null (clear), or an array whose elements are strings (numbers and
// booleans are coerced to strings for convenience).
func parseDecisionsPending(raw json.RawMessage) ([]string, error) {
	if raw == nil {
		return nil, nil
	}
	if string(raw) == "null" {
		return []string{}, nil
	}
	var elems []any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	if err := dec.Decode(&elems); err != nil || elems == nil {
		return nil, errors.New(`field "decisionsPending" must be an array of strings`)
	}
	out := make([]string, 0, len(elems))
	for _, el := range elems {
		switch v := el.(type) {
		case string:
			out = append(out, v)
		case json.Number:
			out = append(out, v.String())
		case bool:
			out = append(out, strconv.FormatBool(v))
		default:
			return nil, errors.New(`field "decisionsPending" must be an array of strings`)
		}
	}
	return out, nil
}

// --- patch application -----------------------------------------------------

// applyTicketPatch validates raw top-level fields against an existing ticket
// and returns the DB column values that should be updated.
//
// Rules:
//   - unknown top-level fields are rejected (the error lists valid ones)
//   - absent fields stay unchanged
//   - an explicit null clears the field to its zero value (strings "", numbers
//     NULL, arrays [], metadata {})
//   - metadata is shallow-merged into the existing metadata; a null value
//     inside it deletes that key
//   - status "finished" cannot be set here; it is user-only
func applyTicketPatch(current *Ticket, fields map[string]json.RawMessage) (map[string]any, error) {
	set := map[string]any{}

	for _, pair := range [][2]string{
		{"content", "content"},
		{"agent", "agent"},
		{"worktree", "worktree"},
		{"tldr", "tldr"},
		{"session_code", "sessionCode"},
	} {
		dbCol, jsonKey := pair[0], pair[1]
		if fields[jsonKey] == nil {
			continue
		}
		v, _, err := parseStringField(jsonKey, fields[jsonKey])
		if err != nil {
			return nil, err
		}
		set[dbCol] = v // explicit null clears to ""
	}

	if fields["issueNumber"] != nil {
		v, ok, err := parseIntField("issueNumber", fields["issueNumber"])
		if err != nil {
			return nil, err
		}
		if ok {
			set["issue_number"] = &v
		} else {
			set["issue_number"] = nil
		}
	}
	if fields["prNumber"] != nil {
		v, ok, err := parseIntField("prNumber", fields["prNumber"])
		if err != nil {
			return nil, err
		}
		if ok {
			set["pr_number"] = &v
		} else {
			set["pr_number"] = nil
		}
	}

	if fields["status"] != nil {
		status, _, err := parseStatusField(fields["status"])
		if err != nil {
			return nil, err
		}
		if status == StatusFinished {
			return nil, fmt.Errorf(
				"status %q is user-only; a ticket is finished via POST /api/v1/tickets/{id}/finish",
				StatusFinished)
		}
		if status != "" {
			set["status"] = status
		}
	}

	if fields["decisionsPending"] != nil {
		decisions, err := parseDecisionsPending(fields["decisionsPending"])
		if err != nil {
			return nil, err
		}
		enc, _ := json.Marshal(decisions)
		set["decisions_pending"] = string(enc)
	}

	if fields["metadata"] != nil {
		merged, err := mergeMetadata(current, fields["metadata"])
		if err != nil {
			return nil, err
		}
		enc, _ := json.Marshal(merged)
		set["metadata"] = string(enc)
	}

	return set, nil
}

// mergeMetadata decodes the incoming metadata object and shallow-merges it
// on top of the ticket's existing metadata. A JSON null value deletes the key.
func mergeMetadata(current *Ticket, raw json.RawMessage) (map[string]any, error) {
	if string(raw) == "null" {
		return map[string]any{}, nil
	}
	var incoming map[string]any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	if err := dec.Decode(&incoming); err != nil {
		return nil, errors.New(`field "metadata" must be a JSON object`)
	}
	merged := map[string]any{}
	for k, v := range current.Metadata {
		merged[k] = v
	}
	for k, v := range incoming {
		if v == nil {
			delete(merged, k)
		} else {
			merged[k] = v
		}
	}
	return merged, nil
}
