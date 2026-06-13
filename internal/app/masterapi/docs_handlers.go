package masterapi

import (
	_ "embed"
	"net/http"

	"github.com/swaggest/swgui/v5emb"
)

//go:embed openapi/openapi.json
var openAPIJSON []byte

func (s *Server) handleOpenAPIJSON(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(openAPIJSON)
}

func swaggerUIHandler() http.Handler {
	return v5emb.New("Rebecca API", "/openapi.json", "/docs/")
}
