package api

import (
	"errors"
	"net/http"
	"strings"

	warpapp "github.com/rebeccapanel/rebecca/internal/app/warp"
)

func (s *Server) handleWarpAccount(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/core/warp" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		account, err := s.warpService.Account(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": warpAccountResponse(account)})
	case http.MethodDelete:
		if err := s.warpService.DeleteLocal(r.Context()); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": nil})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleWarpRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload struct {
		PrivateKey string `json:"private_key"`
		PublicKey  string `json:"public_key"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	account, config, err := s.warpService.Register(r.Context(), strings.TrimSpace(payload.PrivateKey), strings.TrimSpace(payload.PublicKey))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": warpAccountResponse(account), "config": config})
}

func (s *Server) handleWarpLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload struct {
		LicenseKey string `json:"license_key"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	account, err := s.warpService.UpdateLicense(r.Context(), strings.TrimSpace(payload.LicenseKey))
	if err != nil {
		if errors.Is(err, warpapp.ErrAccountNotFound) {
			writeError(w, http.StatusNotFound, "No WARP account configured")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": warpAccountResponse(account)})
}

func (s *Server) handleWarpConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	config, err := s.warpService.RemoteConfig(r.Context())
	if err != nil {
		if errors.Is(err, warpapp.ErrAccountNotFound) {
			writeError(w, http.StatusNotFound, "No WARP account configured")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": config})
}

func warpAccountResponse(account *warpapp.Account) any {
	if account == nil {
		return nil
	}
	var license any
	if strings.TrimSpace(account.LicenseKey) != "" {
		license = account.LicenseKey
	}
	var publicKey any
	if strings.TrimSpace(account.PublicKey) != "" {
		publicKey = account.PublicKey
	}
	return map[string]any{
		"device_id":    account.DeviceID,
		"access_token": account.AccessToken,
		"license_key":  license,
		"private_key":  account.PrivateKey,
		"public_key":   publicKey,
		"created_at":   nullableStringResponseValue(account.CreatedAt),
		"updated_at":   nullableStringResponseValue(account.UpdatedAt),
	}
}
