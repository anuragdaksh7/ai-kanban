package main

import (
	"io"
	"io/fs"
	"net/http"
	"os"
	"strings"
)

// registerWeb serves the built frontend (web/dist) at / with an SPA fallback
// so client-side routes keep working on refresh.
func registerWeb(mux *http.ServeMux, dir string) {
	root := os.DirFS(dir)
	fileServer := http.FileServer(http.FS(root))

	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. Real static assets (/, /assets/..., favicon.ico) are served directly.
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name != "" && !strings.HasSuffix(name, "/") {
			if f, err := root.Open(name); err == nil {
				f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// 2. Hashed /assets files are immutable; a miss means a stale build —
		//    never serve index.html for those.
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			http.Error(w, "not found (stale build?)", http.StatusNotFound)
			return
		}

		// 3. SPA fallback: unknown paths serve the app entry point.
		w.Header().Set("Cache-Control", "no-cache")
		index, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, "frontend build missing: run `npm run build` in web/", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(w, strings.NewReader(string(index)))
	}))
}
