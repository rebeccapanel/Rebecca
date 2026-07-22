package nordvpn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type Service struct {
	repo   Repository
	client Client
}

func NewService(repo Repository, client Client) Service {
	return Service{repo: repo, client: client}
}

func (s Service) Data(ctx context.Context) (*Data, error) {
	return s.repo.First(ctx)
}

func (s Service) SetKey(ctx context.Context, privateKey string) (*Data, error) {
	privateKey = strings.TrimSpace(privateKey)
	if privateKey == "" {
		return nil, errors.New("private key cannot be empty")
	}
	return s.repo.Upsert(ctx, Data{PrivateKey: privateKey})
}

func (s Service) Register(ctx context.Context, token string) (*Data, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("token is required")
	}
	raw, err := s.client.Credentials(ctx, token)
	if err != nil {
		return nil, err
	}
	var response map[string]any
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return nil, fmt.Errorf("NordVPN returned an invalid JSON response")
	}
	privateKey, _ := response["nordlynx_private_key"].(string)
	privateKey = strings.TrimSpace(privateKey)
	if privateKey == "" {
		return nil, errors.New("failed to retrieve NordLynx private key")
	}
	return s.repo.Upsert(ctx, Data{Token: token, PrivateKey: privateKey})
}

func (s Service) Countries(ctx context.Context) (string, error) {
	return s.client.Countries(ctx)
}

func (s Service) Servers(ctx context.Context, countryID string) (string, error) {
	return s.client.Servers(ctx, countryID)
}

func (s Service) Delete(ctx context.Context) error {
	return s.repo.Delete(ctx)
}

func DataJSON(data *Data) string {
	if data == nil {
		return ""
	}
	payload := map[string]string{
		"private_key": strings.TrimSpace(data.PrivateKey),
	}
	if token := strings.TrimSpace(data.Token); token != "" {
		payload["token"] = token
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}
