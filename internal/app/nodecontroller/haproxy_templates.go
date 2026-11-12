package nodecontroller

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

var templateMoPagePattern = regexp.MustCompile(`^/tm-([0-9]{3})-([a-z0-9]+(?:-[a-z0-9]+)*)/?$`)

type HAProxyTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PreviewURL  string `json:"preview_url"`
	DownloadURL string `json:"download_url"`
}

var haproxyTemplateCatalog = []HAProxyTemplate{
	templateMo("594", "Nexus Flow", "nexus_flow"),
	templateMo("593", "Personal Shape", "personal_shape"),
	templateMo("592", "Glossy Touch", "glossy_touch"),
	templateMo("591", "Villa Agency", "villa_agency"),
	templateMo("590", "Topic Listing", "topic_listing"),
	templateMo("589", "Lugx Gaming", "lugx_gaming"),
	templateMo("588", "Ebook Landing", "ebook_landing"),
	templateMo("587", "Tiya Golf Club", "tiya_golf_club"),
	templateMo("586", "Scholar", "scholar"),
	templateMo("585", "Barber Shop", "barber_shop"),
	templateMo("584", "Pod Talk", "pod_talk"),
	templateMo("583", "Festava Live", "festava_live"),
	templateMo("582", "Tale SEO Agency", "tale_seo_agency"),
	templateMo("581", "Kind Heart Charity", "kind_heart_charity"),
	templateMo("580", "Woox Travel", "woox_travel"),
	templateMo("579", "Cyborg Gaming", "cyborg_gaming"),
	templateMo("578", "First Portfolio", "first_portfolio"),
	templateMo("577", "Liberty Market", "liberty_market"),
	templateMo("576", "SnapX Photography", "snapx_photography"),
	templateMo("575", "Leadership Event", "leadership_event"),
	templateMo("574", "Mexant", "mexant"),
	templateMo("573", "EduWell", "eduwell"),
	templateMo("572", "Designer", "designer"),
	templateMo("571", "HexaShop", "hexashop"),
	templateMo("570", "Chain App Dev", "chain_app_dev"),
	templateMo("569", "Edu Meeting", "edu_meeting"),
	templateMo("568", "DigiMedia", "digimedia"),
	templateMo("567", "Nomad Force", "nomad_force"),
	templateMo("566", "Medic Care", "medic_care"),
	templateMo("565", "Onix Digital", "onix_digital"),
	templateMo("564", "Plot Listing", "plot_listing"),
	templateMo("563", "SEO Dream", "seo_dream"),
	templateMo("562", "Space Dynamic", "space_dynamic"),
	templateMo("561", "Purple Buzz", "purple_buzz"),
	templateMo("560", "Astro Motion", "astro_motion"),
	templateMo("559", "Zay Shop", "zay_shop"),
}

func templateMo(id, name, slug string) HAProxyTemplate {
	dashes := ""
	for _, char := range slug {
		if char == '_' {
			dashes += "-"
		} else {
			dashes += string(char)
		}
	}
	return HAProxyTemplate{
		ID: id, Name: name,
		PreviewURL:  "https://templatemo.com/tm-" + id + "-" + dashes,
		DownloadURL: "https://templatemo.com/download/templatemo_" + id + "_" + slug,
	}
}

func HAProxyTemplates() []HAProxyTemplate {
	result := make([]HAProxyTemplate, len(haproxyTemplateCatalog))
	copy(result, haproxyTemplateCatalog)
	return result
}

func HAProxyTemplateByID(id string) (HAProxyTemplate, bool) {
	for _, template := range haproxyTemplateCatalog {
		if template.ID == id {
			return template, true
		}
	}
	return HAProxyTemplate{}, false
}

func ResolveHAProxyTemplateMoURL(raw string) (HAProxyTemplate, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || (parsed.Hostname() != "templatemo.com" && parsed.Hostname() != "www.templatemo.com") || parsed.User != nil || parsed.Port() != "" {
		return HAProxyTemplate{}, fmt.Errorf("invalid TemplateMo page URL")
	}
	match := templateMoPagePattern.FindStringSubmatch(parsed.EscapedPath())
	if len(match) != 3 {
		return HAProxyTemplate{}, fmt.Errorf("TemplateMo URL must look like https://templatemo.com/tm-632-machina")
	}
	slug := match[2]
	return HAProxyTemplate{
		ID:          match[1] + "-" + slug,
		Name:        strings.ReplaceAll(slug, "-", " "),
		PreviewURL:  "https://templatemo.com/tm-" + match[1] + "-" + slug,
		DownloadURL: "https://templatemo.com/download/templatemo_" + match[1] + "_" + strings.ReplaceAll(slug, "-", "_"),
	}, nil
}

func (r Repository) SaveHAProxyTemplate(ctx context.Context, name string, archive []byte) (HAProxyTemplate, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 255 || strings.ContainsAny(name, "\r\n") {
		return HAProxyTemplate{}, fmt.Errorf("template name is required and limited to 255 characters")
	}
	if err := validateHAProxyTemplateArchive(archive); err != nil {
		return HAProxyTemplate{}, err
	}
	sum := sha256.Sum256(archive)
	id := hex.EncodeToString(sum[:])
	_, err := r.db.ExecContext(ctx, `INSERT INTO haproxy_templates (id, name, archive, created_at) VALUES (?, ?, ?, ?)`, id, name, archive, time.Now().UTC())
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "unique") && !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		return HAProxyTemplate{}, err
	}
	return HAProxyTemplate{ID: id, Name: name}, nil
}

const haproxyTemplateMoPrefix = "templatemo:"

func (r Repository) MasterTemplateMoArchive(ctx context.Context, downloadURL string) (string, error) {
	name := haproxyTemplateMoPrefix + downloadURL
	var id string
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM haproxy_templates WHERE name = ? LIMIT 1`, name).Scan(&id); err == nil {
		return id, nil
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("TemplateMo download returned %d", response.StatusCode)
	}
	archive, err := io.ReadAll(io.LimitReader(response.Body, 32<<20+1))
	if err != nil {
		return "", err
	}
	template, err := r.SaveHAProxyTemplate(ctx, name, archive)
	if err != nil {
		return "", err
	}
	return template.ID, nil
}

func (r Repository) HAProxyTemplateArchive(ctx context.Context, id string) (string, []byte, error) {
	if len(id) != 64 {
		return "", nil, fmt.Errorf("template not found")
	}
	var name string
	var archive []byte
	if err := r.db.QueryRowContext(ctx, `SELECT name, archive FROM haproxy_templates WHERE id = ? LIMIT 1`, id).Scan(&name, &archive); err != nil {
		return "", nil, fmt.Errorf("template not found")
	}
	return name, archive, nil
}

func (r Repository) HAProxyUploadedTemplates(ctx context.Context) ([]HAProxyTemplate, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name FROM haproxy_templates WHERE name NOT LIKE 'templatemo:%' ORDER BY name, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []HAProxyTemplate{}
	for rows.Next() {
		var template HAProxyTemplate
		if err := rows.Scan(&template.ID, &template.Name); err != nil {
			return nil, err
		}
		result = append(result, template)
	}
	return result, rows.Err()
}

func validateHAProxyTemplateArchive(archive []byte) error {
	if len(archive) == 0 || len(archive) > 32<<20 {
		return fmt.Errorf("template ZIP must be between 1 byte and 32 MiB")
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return fmt.Errorf("template upload is not a valid ZIP archive")
	}
	if len(reader.File) == 0 || len(reader.File) > 2048 {
		return fmt.Errorf("template ZIP has an invalid file count")
	}
	allowed := map[string]bool{
		".html": true, ".htm": true, ".css": true, ".js": true, ".json": true,
		".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true,
		".webp": true, ".ico": true, ".woff": true, ".woff2": true, ".ttf": true,
		".eot": true, ".otf": true, ".mp4": true, ".webm": true, ".txt": true,
	}
	var total uint64
	hasIndex := false
	for _, file := range reader.File {
		clean := path.Clean(strings.ReplaceAll(file.Name, "\\", "/"))
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
			return fmt.Errorf("template ZIP contains an unsafe path")
		}
		if file.FileInfo().IsDir() {
			continue
		}
		total += file.UncompressedSize64
		if total > 128<<20 {
			return fmt.Errorf("extracted template is limited to 128 MiB")
		}
		if !allowed[strings.ToLower(path.Ext(clean))] {
			return fmt.Errorf("template ZIP contains an unsupported file type")
		}
		if strings.EqualFold(path.Base(clean), "index.html") {
			hasIndex = true
		}
	}
	if !hasIndex {
		return fmt.Errorf("template ZIP must contain index.html")
	}
	return nil
}
