package api

import (
	"context"
	"net/http"
	"time"

	nodeapp "github.com/rebeccapanel/rebecca/internal/app/node"
)

func (s *Server) handleNodeRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/node" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload nodeapp.NodeCreate
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	node, err := s.nodeMutations.CreateNode(ctx, payload)
	if err != nil {
		writeNodeMutationError(w, err)
		return
	}
	// TODO: send node_created report through Go Telegram reports.
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleNodeSettings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	settings, err := s.nodeMutations.Settings(ctx)
	if err != nil {
		writeNodeMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleNodeCertificateNew(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	pending, err := s.nodeMutations.CreatePendingCertificate(ctx, nodeapp.DefaultPendingCertificateTTL)
	if err != nil {
		writeNodeMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"certificate":       pending.Certificate,
		"certificate_token": pending.Token,
	})
}

func (s *Server) handleNodeUpdate(w http.ResponseWriter, r *http.Request, nodeID int64) {
	var payload nodeapp.NodeModify
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	node, err := s.nodeMutations.UpdateNode(ctx, nodeID, payload)
	if err != nil {
		writeNodeMutationError(w, err)
		return
	}
	// TODO: send node_status_change report through Go Telegram reports.
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleNodeDelete(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if err := s.nodeMutations.DeleteNode(ctx, nodeID); err != nil {
		writeNodeMutationError(w, err)
		return
	}
	// TODO: send node_deleted report through Go Telegram reports.
	writeJSON(w, http.StatusOK, map[string]any{})
}

func (s *Server) handleNodeCertificateRegenerate(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	node, err := s.nodeMutations.RegenerateNodeCertificate(ctx, nodeID)
	if err != nil {
		writeNodeMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleNodeUsageReset(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	node, err := s.nodeMutations.ResetNodeUsage(ctx, nodeID)
	if err != nil {
		writeNodeMutationError(w, err)
		return
	}
	// TODO: send node_usage_reset report through Go Telegram reports.
	writeJSON(w, http.StatusOK, node)
}

func writeNodeMutationError(w http.ResponseWriter, err error) {
	switch {
	case nodeapp.IsKind(err, nodeapp.ErrorNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case nodeapp.IsKind(err, nodeapp.ErrorConflict):
		writeError(w, http.StatusConflict, err.Error())
	case nodeapp.IsKind(err, nodeapp.ErrorInvalid), nodeapp.IsKind(err, nodeapp.ErrorExpired):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
