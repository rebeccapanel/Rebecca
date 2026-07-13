package settings

type PanelSettings struct {
	DefaultSubscriptionType string `json:"default_subscription_type"`
}

type PanelSettingsUpdate struct {
	DefaultSubscriptionType *string `json:"default_subscription_type,omitempty"`
}

type RuntimeSettings struct {
	DashboardPath        string `json:"dashboard_path"`
	RecordNodeUsage      bool   `json:"record_node_usage"`
	RecordNodeUserUsages bool   `json:"record_node_user_usages"`
	SubscriptionReadOnly bool   `json:"subscription_read_only"`
	APIDocsEnabled       bool   `json:"api_docs_enabled"`
	PHPMyAdminEnabled    bool   `json:"phpmyadmin_enabled"`
	PHPMyAdminPort       int    `json:"phpmyadmin_port"`
	PHPMyAdminPath       string `json:"phpmyadmin_path"`
	PHPMyAdminPublicURL  string `json:"phpmyadmin_public_url"`
	PHPMyAdminLoginMode  string `json:"phpmyadmin_login_mode"`
	PHPMyAdminUsername   string `json:"phpmyadmin_username"`
	PHPMyAdminPassword   string `json:"phpmyadmin_password"`
}

type RuntimeSettingsUpdate struct {
	DashboardPath        *string `json:"dashboard_path,omitempty"`
	RecordNodeUsage      *bool   `json:"record_node_usage,omitempty"`
	RecordNodeUserUsages *bool   `json:"record_node_user_usages,omitempty"`
	SubscriptionReadOnly *bool   `json:"subscription_read_only,omitempty"`
	APIDocsEnabled       *bool   `json:"api_docs_enabled,omitempty"`
	PHPMyAdminEnabled    *bool   `json:"phpmyadmin_enabled,omitempty"`
	PHPMyAdminPort       *int    `json:"phpmyadmin_port,omitempty"`
	PHPMyAdminPath       *string `json:"phpmyadmin_path,omitempty"`
	PHPMyAdminPublicURL  *string `json:"phpmyadmin_public_url,omitempty"`
	PHPMyAdminLoginMode  *string `json:"phpmyadmin_login_mode,omitempty"`
	PHPMyAdminUsername   *string `json:"phpmyadmin_username,omitempty"`
	PHPMyAdminPassword   *string `json:"phpmyadmin_password,omitempty"`
}

type SubscriptionSettings struct {
	SubscriptionURLPrefix       string   `json:"subscription_url_prefix"`
	SubscriptionProfileTitle    string   `json:"subscription_profile_title"`
	SubscriptionSupportURL      string   `json:"subscription_support_url"`
	SubscriptionUpdateInterval  string   `json:"subscription_update_interval"`
	CustomTemplatesDirectory    *string  `json:"custom_templates_directory"`
	ClashSubscriptionTemplate   string   `json:"clash_subscription_template"`
	ClashSettingsTemplate       string   `json:"clash_settings_template"`
	SubscriptionPageTemplate    string   `json:"subscription_page_template"`
	HomePageTemplate            string   `json:"home_page_template"`
	V2RaySubscriptionTemplate   string   `json:"v2ray_subscription_template"`
	V2RaySettingsTemplate       string   `json:"v2ray_settings_template"`
	HappSubscriptionTemplate    string   `json:"happ_subscription_template"`
	IncySubscriptionTemplate    string   `json:"incy_subscription_template"`
	SingBoxSubscriptionTemplate string   `json:"singbox_subscription_template"`
	SingBoxSettingsTemplate     string   `json:"singbox_settings_template"`
	MuxTemplate                 string   `json:"mux_template"`
	UseCustomJSONDefault        bool     `json:"use_custom_json_default"`
	UseCustomJSONForV2RayN      bool     `json:"use_custom_json_for_v2rayn"`
	UseCustomJSONForV2RayNG     bool     `json:"use_custom_json_for_v2rayng"`
	UseCustomJSONForStreisand   bool     `json:"use_custom_json_for_streisand"`
	UseCustomJSONForHapp        bool     `json:"use_custom_json_for_happ"`
	UseCustomJSONForIncy        bool     `json:"use_custom_json_for_incy"`
	SubscriptionPath            string   `json:"subscription_path"`
	SubscriptionAliases         []string `json:"subscription_aliases"`
	SubscriptionPorts           []int    `json:"subscription_ports"`
}

type SubscriptionSettingsUpdate struct {
	SubscriptionURLPrefix       *string   `json:"subscription_url_prefix,omitempty"`
	SubscriptionProfileTitle    *string   `json:"subscription_profile_title,omitempty"`
	SubscriptionSupportURL      *string   `json:"subscription_support_url,omitempty"`
	SubscriptionUpdateInterval  *string   `json:"subscription_update_interval,omitempty"`
	CustomTemplatesDirectory    *string   `json:"custom_templates_directory,omitempty"`
	ClashSubscriptionTemplate   *string   `json:"clash_subscription_template,omitempty"`
	ClashSettingsTemplate       *string   `json:"clash_settings_template,omitempty"`
	SubscriptionPageTemplate    *string   `json:"subscription_page_template,omitempty"`
	HomePageTemplate            *string   `json:"home_page_template,omitempty"`
	V2RaySubscriptionTemplate   *string   `json:"v2ray_subscription_template,omitempty"`
	V2RaySettingsTemplate       *string   `json:"v2ray_settings_template,omitempty"`
	HappSubscriptionTemplate    *string   `json:"happ_subscription_template,omitempty"`
	IncySubscriptionTemplate    *string   `json:"incy_subscription_template,omitempty"`
	SingBoxSubscriptionTemplate *string   `json:"singbox_subscription_template,omitempty"`
	SingBoxSettingsTemplate     *string   `json:"singbox_settings_template,omitempty"`
	MuxTemplate                 *string   `json:"mux_template,omitempty"`
	UseCustomJSONDefault        *bool     `json:"use_custom_json_default,omitempty"`
	UseCustomJSONForV2RayN      *bool     `json:"use_custom_json_for_v2rayn,omitempty"`
	UseCustomJSONForV2RayNG     *bool     `json:"use_custom_json_for_v2rayng,omitempty"`
	UseCustomJSONForStreisand   *bool     `json:"use_custom_json_for_streisand,omitempty"`
	UseCustomJSONForHapp        *bool     `json:"use_custom_json_for_happ,omitempty"`
	UseCustomJSONForIncy        *bool     `json:"use_custom_json_for_incy,omitempty"`
	SubscriptionPath            *string   `json:"subscription_path,omitempty"`
	SubscriptionAliases         *[]string `json:"subscription_aliases,omitempty"`
	SubscriptionPorts           *[]int    `json:"subscription_ports,omitempty"`
}

type AdminSubscriptionSettings struct {
	ID                   int64          `json:"id"`
	Username             string         `json:"username"`
	SubscriptionDomain   *string        `json:"subscription_domain"`
	SubscriptionSettings map[string]any `json:"subscription_settings"`
}

type AdminSubscriptionSettingsUpdate struct {
	SubscriptionDomain   *string         `json:"subscription_domain,omitempty"`
	SubscriptionSettings *map[string]any `json:"subscription_settings,omitempty"`
}

type SubscriptionCertificate struct {
	ID            *int64   `json:"id"`
	Domain        string   `json:"domain"`
	AdminID       *int64   `json:"admin_id"`
	Email         *string  `json:"email"`
	Provider      *string  `json:"provider"`
	AltNames      []string `json:"alt_names"`
	LastIssuedAt  *string  `json:"last_issued_at"`
	LastRenewedAt *string  `json:"last_renewed_at"`
	Path          string   `json:"path"`
}

type SubscriptionBundle struct {
	Settings     SubscriptionSettings        `json:"settings"`
	Admins       []AdminSubscriptionSettings `json:"admins"`
	Certificates []SubscriptionCertificate   `json:"certificates"`
}

type TemplateContent struct {
	TemplateKey     string  `json:"template_key"`
	TemplateName    string  `json:"template_name"`
	CustomDirectory *string `json:"custom_directory"`
	ResolvedPath    *string `json:"resolved_path"`
	AdminID         *int64  `json:"admin_id"`
	Content         string  `json:"content"`
}
