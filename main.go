// Command ai-kanban is a small self-hosted Kanban board for tracking AI agent
// sessions: agents create tickets, leave reports/decisions/statuses on them,
// and each ticket carries the agent's session code so you can resume it
// (e.g. `claude --resume <sessionCode>`).
//
// Run:
//
//	go run .            # serve on http://localhost:8787
//	cd web && npm run build   # then the Go server also serves the UI at /
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	port := flag.Int("port", 8787, "TCP port to listen on")
	host := flag.String("host", "127.0.0.1", "address to bind to (use 0.0.0.0 to expose on the network)")
	dbPath := flag.String("db", "data/kanban.db", "path to the SQLite database file")
	webDir := flag.String("web", "web/dist", "directory containing the built frontend, served at / (set to \"\" to disable)")
	flag.Parse()

	db, err := openDB(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	s := newServer(db)

	mux := http.NewServeMux()
	registerAPI(mux, s)

	if *webDir != "" {
		if info, statErr := os.Stat(*webDir); statErr != nil || !info.IsDir() {
			log.Printf("web dir %q not found (run `npm run build` inside web/); serving API only", *webDir)
		} else {
			registerWeb(mux, *webDir)
			log.Printf("serving frontend from %q at /", *webDir)
		}
	}

	addr := fmt.Sprintf("%s:%d", *host, *port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           withLogging(withCORS(mux)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("AI Kanban listening on http://%s", friendlyAddr(addr))
		log.Printf("API base: http://%s/api/v1  |  health: http://%s/api/v1/health", friendlyAddr(addr), friendlyAddr(addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// friendlyAddr makes "127.0.0.1" read as "localhost".
func friendlyAddr(addr string) string {
	if len(addr) > 9 && addr[:9] == "127.0.0.1" {
		return "localhost" + addr[9:]
	}
	return addr
}
