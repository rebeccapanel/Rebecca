package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const geoTemplatesIndexDefault = "https://raw.githubusercontent.com/ppouria/geo-templates/main/index.json"

var allowedGeoFilenames = map[string]struct{}{
	"geoip.dat":   {},
	"geosite.dat": {},
}

type geoUpdatePayload struct {
	Mode                  string                `json:"mode"`
	TemplateIndexURL      string                `json:"template_index_url"`
	TemplateIndexURLCamel string                `json:"templateIndexUrl"`
	TemplateName          string                `json:"template_name"`
	TemplateNameCamel     string                `json:"templateName"`
	Files                 []nodecontroller.File `json:"files"`
	ApplyToNodes          *bool                 `json:"apply_to_nodes"`
	ApplyToNodesCamel     *bool                 `json:"applyToNodes"`
	SkipNodeIDs           []int64               `json:"skip_node_ids"`
	SkipNodeIDsCamel      []int64               `json:"skipNodeIds"`
}

func resolveGeoUpdateFiles(ctx context.Context, payload geoUpdatePayload) ([]nodecontroller.File, int, error) {
	files := payload.Files
	mode := strings.ToLower(strings.TrimSpace(payload.Mode))
	templateName := firstNonEmptyString(payload.TemplateName, payload.TemplateNameCamel)
	templateIndexURL := firstNonEmptyString(payload.TemplateIndexURL, payload.TemplateIndexURLCamel, geoTemplatesIndexDefault)

	if len(files) == 0 && (mode == "template" || templateName != "") {
		indexURL, err := resolveGeoTemplateIndexURL(templateIndexURL)
		if err != nil {
			return nil, http.StatusUnprocessableEntity, err
		}
		fetchedFiles, status, err := fetchGeoTemplateFiles(ctx, indexURL, templateName)
		if err != nil {
			return nil, status, err
		}
		files = fetchedFiles
	}

	if len(files) == 0 {
		return nil, http.StatusUnprocessableEntity, fmt.Errorf("'files' must be a non-empty list of {name,url}")
	}
	validated, err := validateGeoFiles(files)
	if err != nil {
		return nil, http.StatusUnprocessableEntity, err
	}
	return validated, http.StatusOK, nil
}

func resolveGeoTemplateIndexURL(candidateURL string) (string, error) {
	requestedURL := strings.TrimSpace(candidateURL)
	if requestedURL == "" {
		return geoTemplatesIndexDefault, nil
	}
	if requestedURL == geoTemplatesIndexDefault {
		return requestedURL, nil
	}
	return "", fmt.Errorf("template_index_url must be empty or the default template index")
}

func fetchGeoTemplateFiles(ctx context.Context, indexURL string, templateName string) ([]nodecontroller.File, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to fetch template index: %w", err)
	}
	client := http.Client{Timeout: 60 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to fetch template index: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to fetch template index: status %d", response.StatusCode)
	}
	var data any
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to parse template index: %w", err)
	}
	files, status, err := geoTemplateFilesFromIndex(data, templateName)
	if err != nil {
		return nil, status, err
	}
	files = allowedGeoTemplateFiles(files)
	if len(files) == 0 {
		return nil, http.StatusUnprocessableEntity, fmt.Errorf("template has no supported geo files")
	}
	return files, http.StatusOK, nil
}

func fetchGeoTemplates(ctx context.Context, indexURL string) ([]map[string]any, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to fetch index: %w", err)
	}
	client := http.Client{Timeout: 60 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to fetch index: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to fetch index: status %d", response.StatusCode)
	}
	var data any
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to parse template index: %w", err)
	}
	templates := geoTemplatesFromIndex(data)
	if len(templates) == 0 {
		return nil, http.StatusNotFound, fmt.Errorf("no templates found in index")
	}
	return templates, http.StatusOK, nil
}

func geoTemplatesFromIndex(data any) []map[string]any {
	candidates := templateCandidates(data)
	result := make([]map[string]any, 0, len(candidates))
	for _, candidate := range candidates {
		name, ok := stringFromMap(candidate, "name")
		if !ok || name == "" {
			continue
		}
		if rawFiles, exists := candidate["files"]; exists {
			files := filesFromList(rawFiles)
			if len(files) > 0 {
				items := make([]map[string]string, 0, len(files))
				for _, file := range files {
					items = append(items, map[string]string{"name": file.Name, "url": file.URL})
				}
				result = append(result, map[string]any{"name": name, "files": items})
				continue
			}
		}
		if links, ok := candidate["links"].(map[string]any); ok && len(links) > 0 {
			cleanLinks := map[string]string{}
			for key, raw := range links {
				if value, ok := raw.(string); ok && strings.TrimSpace(value) != "" {
					cleanLinks[key] = strings.TrimSpace(value)
				}
			}
			if len(cleanLinks) > 0 {
				result = append(result, map[string]any{"name": name, "links": cleanLinks})
			}
		}
	}
	return result
}

func geoTemplateFilesFromIndex(data any, templateName string) ([]nodecontroller.File, int, error) {
	candidates := templateCandidates(data)
	if len(candidates) == 0 {
		return nil, http.StatusNotFound, fmt.Errorf("no templates found in index")
	}
	targetName := strings.TrimSpace(templateName)
	if targetName == "" {
		targetName, _ = stringFromMap(candidates[0], "name")
	}
	var selected map[string]any
	for _, candidate := range candidates {
		name, _ := stringFromMap(candidate, "name")
		if name == targetName {
			selected = candidate
			break
		}
	}
	if selected == nil {
		return nil, http.StatusNotFound, fmt.Errorf("template not found in index")
	}
	files := filesFromTemplate(selected)
	if len(files) == 0 {
		return nil, http.StatusUnprocessableEntity, fmt.Errorf("template has no geo files")
	}
	return files, http.StatusOK, nil
}

func templateCandidates(data any) []map[string]any {
	if root, ok := data.(map[string]any); ok {
		if rawTemplates, exists := root["templates"]; exists {
			return listOfMaps(rawTemplates)
		}
		return nil
	}
	return listOfMaps(data)
}

func filesFromTemplate(template map[string]any) []nodecontroller.File {
	if rawFiles, exists := template["files"]; exists {
		files := filesFromList(rawFiles)
		if len(files) > 0 {
			return files
		}
	}
	links, ok := template["links"].(map[string]any)
	if !ok {
		return nil
	}
	files := make([]nodecontroller.File, 0, len(links))
	for name, rawURL := range links {
		urlValue, ok := rawURL.(string)
		if !ok {
			continue
		}
		files = append(files, nodecontroller.File{Name: name, URL: urlValue})
	}
	return files
}

func filesFromList(value any) []nodecontroller.File {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	files := make([]nodecontroller.File, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, nameOK := stringFromMap(mapped, "name")
		urlValue, urlOK := stringFromMap(mapped, "url")
		if nameOK && urlOK {
			files = append(files, nodecontroller.File{Name: name, URL: urlValue})
		}
	}
	return files
}

func validateGeoFiles(files []nodecontroller.File) ([]nodecontroller.File, error) {
	validated := make([]nodecontroller.File, 0, len(files))
	for _, file := range files {
		name, err := safeGeoFilename(file.Name)
		if err != nil {
			return nil, err
		}
		urlValue, err := validateDownloadURL(file.URL, "url")
		if err != nil {
			return nil, err
		}
		validated = append(validated, nodecontroller.File{Name: name, URL: urlValue})
	}
	return validated, nil
}

func allowedGeoTemplateFiles(files []nodecontroller.File) []nodecontroller.File {
	filtered := make([]nodecontroller.File, 0, len(files))
	for _, file := range files {
		name := filepath.Base(strings.ReplaceAll(strings.TrimSpace(file.Name), "\\", "/"))
		if _, ok := allowedGeoFilenames[name]; ok {
			filtered = append(filtered, nodecontroller.File{Name: name, URL: file.URL})
		}
	}
	return filtered
}

func safeGeoFilename(name string) (string, error) {
	filename := filepath.Base(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	if _, ok := allowedGeoFilenames[filename]; ok {
		return filename, nil
	}
	return "", fmt.Errorf("geo file name must be one of: geoip.dat, geosite.dat")
}

func validateDownloadURL(rawURL string, fieldName string) (string, error) {
	candidate := strings.TrimSpace(rawURL)
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Scheme == "" || parsed.Hostname() == "" {
		return "", fmt.Errorf("%s must be an http(s) URL", fieldName)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%s must be an http(s) URL", fieldName)
	}
	addresses, err := net.LookupIP(parsed.Hostname())
	if err != nil {
		return "", fmt.Errorf("%s hostname cannot be resolved", fieldName)
	}
	for _, address := range addresses {
		if address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() ||
			address.IsLinkLocalMulticast() || address.IsMulticast() || address.IsUnspecified() {
			return "", fmt.Errorf("%s resolves to a private or reserved address", fieldName)
		}
	}
	return candidate, nil
}

func listOfMaps(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if ok {
			result = append(result, mapped)
		}
	}
	return result
}

func stringFromMap(value map[string]any, key string) (string, bool) {
	raw, ok := value[key]
	if !ok {
		return "", false
	}
	text, ok := raw.(string)
	if !ok {
		return "", false
	}
	return strings.TrimSpace(text), true
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
