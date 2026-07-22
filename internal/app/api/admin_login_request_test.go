package api

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadAdminLoginRequestMultipartForm(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("username", "pouria"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("password", "pass123"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("grant_type", "password"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/admin/token", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	got, err := readAdminLoginRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.Username != "pouria" || got.Password != "pass123" {
		t.Fatalf("unexpected credentials: %#v", got)
	}
}
