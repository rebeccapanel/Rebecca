package warp

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

var ErrAccountNotFound = errors.New("No WARP account is registered yet.")

type Service struct {
	repo   Repository
	client Client
}

func NewService(repo Repository, client Client) Service {
	return Service{repo: repo, client: client}
}

func (s Service) Account(ctx context.Context) (*Account, error) {
	return s.repo.First(ctx)
}

func (s Service) Register(ctx context.Context, privateKey string, publicKey string) (*Account, map[string]any, error) {
	if len(strings.TrimSpace(privateKey)) < 16 || len(strings.TrimSpace(publicKey)) < 16 {
		return nil, nil, fmt.Errorf("Both private and public keys are required for registration.")
	}
	config, err := s.client.Register(ctx, privateKey, publicKey)
	if err != nil {
		return nil, nil, err
	}
	deviceID := strings.TrimSpace(stringFromMap(config, "id"))
	accessToken := strings.TrimSpace(stringFromMap(config, "token"))
	if deviceID == "" || accessToken == "" {
		return nil, nil, fmt.Errorf("Cloudflare response is missing device id or access token.")
	}
	accountInfo, _ := config["account"].(map[string]any)
	licenseKey := stringFromMap(accountInfo, "license")
	account, err := s.repo.Upsert(ctx, Account{
		DeviceID:    deviceID,
		AccessToken: accessToken,
		LicenseKey:  licenseKey,
		PrivateKey:  strings.TrimSpace(privateKey),
		PublicKey:   strings.TrimSpace(publicKey),
	})
	if err != nil {
		return nil, nil, err
	}
	return account, config, nil
}

func (s Service) UpdateLicense(ctx context.Context, licenseKey string) (*Account, error) {
	if len(strings.TrimSpace(licenseKey)) < 10 {
		return nil, fmt.Errorf("license_key is too short")
	}
	account, err := s.repo.First(ctx)
	if err != nil {
		return nil, err
	}
	if account == nil {
		return nil, ErrAccountNotFound
	}
	response, err := s.client.UpdateLicense(ctx, account.DeviceID, account.AccessToken, strings.TrimSpace(licenseKey))
	if err != nil {
		return nil, err
	}
	if success, exists := boolFromMap(response, "success"); exists && !success {
		if message := firstCloudflareError(response); message != "" {
			return nil, errors.New(message)
		}
		return nil, fmt.Errorf("Failed to update WARP license")
	}
	return s.repo.UpdateLicense(ctx, account.ID, strings.TrimSpace(licenseKey))
}

func (s Service) RemoteConfig(ctx context.Context) (map[string]any, error) {
	account, err := s.repo.First(ctx)
	if err != nil {
		return nil, err
	}
	if account == nil {
		return nil, ErrAccountNotFound
	}
	return s.client.RemoteConfig(ctx, account.DeviceID, account.AccessToken)
}

func (s Service) DeleteLocal(ctx context.Context) error {
	return s.repo.DeleteLocal(ctx)
}

func stringFromMap(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	switch typed := data[key].(type) {
	case string:
		return typed
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func boolFromMap(data map[string]any, key string) (bool, bool) {
	if data == nil {
		return false, false
	}
	switch typed := data[key].(type) {
	case bool:
		return typed, true
	default:
		return false, false
	}
}

func firstCloudflareError(data map[string]any) string {
	items, _ := data["errors"].([]any)
	if len(items) == 0 {
		return ""
	}
	item, _ := items[0].(map[string]any)
	return strings.TrimSpace(stringFromMap(item, "message"))
}
