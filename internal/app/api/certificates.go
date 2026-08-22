package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	certificateapp "github.com/rebeccapanel/rebecca/internal/app/certificates"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
)

const certificateRequestLimit = 256 << 10

func (s *Server) handleCertificateIssue(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload struct {
		Email    string   `json:"email"`
		Domains  []string `json:"domains"`
		AdminID  *int64   `json:"admin_id"`
		Provider string   `json:"provider"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, certificateRequestLimit)
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	record, err := s.certificateManager.Issue(r.Context(), certificateapp.IssueRequest{
		Email:    payload.Email,
		Domains:  payload.Domains,
		AdminID:  payload.AdminID,
		Provider: payload.Provider,
	})
	writeCertificateResponse(w, record, err)
}

func (s *Server) handleCertificateImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload struct {
		Domain     string `json:"domain"`
		AdminID    *int64 `json:"admin_id"`
		Fullchain  string `json:"fullchain"`
		PrivateKey string `json:"private_key"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, certificateRequestLimit)
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	record, err := s.certificateManager.Import(r.Context(), certificateapp.ImportRequest{
		Domain:     payload.Domain,
		AdminID:    payload.AdminID,
		Fullchain:  payload.Fullchain,
		PrivateKey: payload.PrivateKey,
	})
	writeCertificateResponse(w, record, err)
}

func (s *Server) handleCertificateRenew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload struct {
		Domain string `json:"domain"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(payload.Domain) == "" {
		writeError(w, http.StatusBadRequest, "domain is required")
		return
	}
	record, err := s.certificateManager.Renew(r.Context(), payload.Domain)
	writeCertificateResponse(w, record, err)
}

func (s *Server) handleCertificatePath(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/settings/subscriptions/certificates/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodDelete:
			if err := s.certificateManager.Delete(r.Context(), parts[0]); err != nil {
				writeCertificateError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case http.MethodPut:
			var payload struct {
				ServeTLS *bool `json:"serve_tls"`
			}
			if err := decodeOptionalJSON(r, &payload); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if payload.ServeTLS == nil {
				writeError(w, http.StatusBadRequest, "serve_tls is required")
				return
			}
			record, err := s.certificateManager.SetServeTLS(r.Context(), parts[0], *payload.ServeTLS)
			writeCertificateResponse(w, record, err)
			return
		}
	}
	if len(parts) != 2 || parts[1] != "revoke" || r.Method != http.MethodPost {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	record, err := s.certificateManager.Revoke(r.Context(), parts[0])
	writeCertificateResponse(w, record, err)
}

func writeCertificateResponse(w http.ResponseWriter, record certificateapp.Record, err error) {
	if err != nil {
		writeCertificateError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func writeCertificateError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, certificateapp.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, certificateapp.ErrBusy):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, certificateapp.ErrUnsupported):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case strings.Contains(strings.ToLower(err.Error()), "certbot failed"):
		writeError(w, http.StatusBadGateway, err.Error())
	default:
		writeError(w, http.StatusBadRequest, err.Error())
	}
}

func (s *Server) runCertificateRenewalWorker(ctx context.Context) {
	const interval = 12 * time.Hour
	timer := time.NewTimer(5 * time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			for _, err := range s.certificateManager.RenewDue(ctx, time.Now().UTC().Add(30*24*time.Hour)) {
				if !errors.Is(err, certificateapp.ErrBusy) {
					logging.Warnf(logging.ComponentRuntime, "certificate auto-renewal warning: %v", err)
				}
			}
			timer.Reset(interval)
		}
	}
}
