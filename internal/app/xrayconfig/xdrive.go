package xrayconfig

import (
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/jsonvalue"
)

const (
	xdriveServiceGoogleDrive       = "google-drive"
	xdriveServiceGoogleDriveLegacy = "Google Drive"
)

func canonicalizeXDriveService(inbound map[string]any) {
	stream := mapValue(inbound["streamSettings"])
	if streamNetwork(stream) != "xdrive" {
		return
	}
	settings := mapValue(stream["xdriveSettings"])
	if jsonvalue.String(settings["service"]) == xdriveServiceGoogleDriveLegacy {
		settings["service"] = xdriveServiceGoogleDrive
		stream["xdriveSettings"] = settings
		inbound["streamSettings"] = stream
	}
}

func validateXDriveInbound(tag, protocol string, settings, stream map[string]any) error {
	if streamNetwork(stream) != "xdrive" {
		return nil
	}
	if protocol != "vless" {
		return fmt.Errorf("invalid inbound %q: XDRIVE carries only VLESS, not %s", tag, protocol)
	}
	if !vlessEncryptionEnabled(settings["decryption"]) {
		return fmt.Errorf("invalid inbound %q: XDRIVE needs VLESS encryption: set the inbound's Decryption", tag)
	}
	if err := validateXDriveStorage(mapValue(stream["xdriveSettings"])); err != nil {
		return fmt.Errorf("invalid inbound %q: %w", tag, err)
	}
	return nil
}

func validateXDriveStorage(xd map[string]any) error {
	service := jsonvalue.String(xd["service"])
	hasFolder := strings.TrimSpace(jsonvalue.String(xd["remoteFolder"])) != ""
	secrets := stringList(xd["secrets"])
	switch service {
	case "local":
		if !hasFolder {
			return fmt.Errorf(`XDRIVE needs a "remoteFolder": the local folder both ends share`)
		}
	case xdriveServiceGoogleDrive, xdriveServiceGoogleDriveLegacy:
		if !hasFolder {
			return fmt.Errorf(`XDRIVE needs a "remoteFolder": the id of the shared Google Drive folder`)
		}
		if len(secrets) != 3 || hasBlank(secrets) {
			return fmt.Errorf("Google Drive needs 3 secrets, in order: ClientID, ClientSecret, RefreshToken")
		}
	case "template":
		template, ok := xd["template"].(map[string]any)
		if !ok || template == nil {
			return fmt.Errorf(`XDRIVE service "template" needs a "template" object describing the storage API`)
		}
		return validateXDriveTemplate(template)
	case "s3":
		return validateXDriveS3(xd, secrets)
	default:
		return fmt.Errorf("unsupported XDRIVE service %q: use local, google-drive, template or s3", service)
	}
	return nil
}

func hasBlank(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return true
		}
	}
	return false
}

func validateXDriveS3(xd map[string]any, secrets []string) error {
	s3, ok := xd["s3"].(map[string]any)
	if !ok || s3 == nil {
		return fmt.Errorf(`XDRIVE service "s3" needs an "s3" object`)
	}
	endpoint, err := url.Parse(strings.TrimSpace(jsonvalue.String(s3["endpoint"])))
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Hostname() == "" {
		return fmt.Errorf("XDRIVE S3 endpoint must be an http(s) URL")
	}
	if strings.TrimSpace(jsonvalue.String(s3["bucket"])) == "" {
		return fmt.Errorf("XDRIVE S3 needs a bucket")
	}
	if len(secrets) < 2 || len(secrets) > 3 || hasBlank(secrets[:2]) {
		return fmt.Errorf("XDRIVE S3 needs AccessKeyID, SecretAccessKey and an optional SessionToken")
	}
	if pathStyle, set := s3["pathStyle"].(bool); set && !pathStyle {
		if _, err := netip.ParseAddr(endpoint.Hostname()); err == nil {
			return fmt.Errorf("XDRIVE S3 virtual-hosted style requires a DNS endpoint")
		}
	}
	return nil
}

func validateXDriveTemplate(template map[string]any) error {
	operation := func(name string) (string, string) {
		op := mapValue(template[name])
		return jsonvalue.String(op["url"]), jsonvalue.String(op["namesRegex"])
	}
	putURL, _ := operation("put")
	getURL, _ := operation("get")
	listURL, namesRegex := operation("list")
	deleteURL, _ := operation("delete")
	if putURL == "" || getURL == "" || listURL == "" || deleteURL == "" {
		return fmt.Errorf("XDRIVE template needs put, get, list and delete operations, each with a url")
	}
	if namesRegex == "" {
		return fmt.Errorf("XDRIVE template list needs a namesRegex")
	}
	names, err := regexp.Compile(namesRegex)
	if err != nil {
		return fmt.Errorf("XDRIVE template namesRegex does not compile: %w", err)
	}
	if names.NumSubexp() < 1 {
		return fmt.Errorf("XDRIVE template namesRegex needs one capture group for the object name")
	}
	return nil
}
