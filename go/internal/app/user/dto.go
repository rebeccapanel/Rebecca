package user

import "encoding/json"

const (
	ActionLinkPrerequisites = "user.link_prerequisites"
	ActionSubscriptionLinks = "user.subscription_links"
	ActionConfigLinks       = "user.config_links"
	ActionUsersList         = "users.list"
	ActionUserGet           = "user.get"
)

type AdminContext struct {
	ID             *int64 `json:"id,omitempty"`
	Username       string `json:"username"`
	Role           string `json:"role"`
	CanViewTraffic bool   `json:"can_view_traffic"`
	CanSortTraffic bool   `json:"can_sort_traffic"`
}

type SortOption struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}

type UsersListRequest struct {
	Offset          *int64       `json:"offset,omitempty"`
	Limit           *int64       `json:"limit,omitempty"`
	Usernames       []string     `json:"usernames,omitempty"`
	Search          string       `json:"search,omitempty"`
	Owners          []string     `json:"owners,omitempty"`
	Status          string       `json:"status,omitempty"`
	AdvancedFilters []string     `json:"advanced_filters,omitempty"`
	ServiceID       *int64       `json:"service_id,omitempty"`
	Sort            []SortOption `json:"sort,omitempty"`
	IncludeLinks    bool         `json:"include_links"`
	RequestOrigin   string       `json:"request_origin,omitempty"`
	Admin           AdminContext `json:"admin"`
}

type UserGetRequest struct {
	Username      string       `json:"username"`
	RequestOrigin string       `json:"request_origin,omitempty"`
	Admin         AdminContext `json:"admin"`
}

type LinkPrerequisitesRequest struct {
	UserIDs       []int64 `json:"user_ids,omitempty"`
	ServiceIDs    []int64 `json:"service_ids,omitempty"`
	AdminIDs      []int64 `json:"admin_ids,omitempty"`
	RequestOrigin string  `json:"request_origin,omitempty"`
}

type ConfigLinksRequest struct {
	UserID  int64           `json:"user_id,omitempty"`
	User    *ConfigLinkUser `json:"user,omitempty"`
	Reverse bool            `json:"reverse,omitempty"`
}

type ConfigLinksResponse struct {
	Links []string `json:"links"`
}

type ConfigLinkUser struct {
	ID                   int64                      `json:"id"`
	Username             string                     `json:"username"`
	Status               string                     `json:"status"`
	UsedTraffic          int64                      `json:"used_traffic"`
	DataLimit            *int64                     `json:"data_limit,omitempty"`
	Expire               *int64                     `json:"expire,omitempty"`
	OnHoldExpireDuration *int64                     `json:"on_hold_expire_duration,omitempty"`
	ServiceID            *int64                     `json:"service_id,omitempty"`
	CredentialKey        string                     `json:"credential_key,omitempty"`
	Flow                 string                     `json:"flow,omitempty"`
	Proxies              []StoredProxy              `json:"proxies,omitempty"`
	Inbounds             map[string][]string        `json:"inbounds,omitempty"`
	ServiceHostOrders    map[int64]int64            `json:"service_host_orders,omitempty"`
	XrayInboundsByTag    map[string]ResolvedInbound `json:"xray_inbounds_by_tag,omitempty"`
	XrayInboundOrder     []string                   `json:"xray_inbound_order,omitempty"`
	Hosts                []Host                     `json:"hosts,omitempty"`
}

type UserListItem struct {
	ID                     int64            `json:"-"`
	Username               string           `json:"username"`
	Status                 string           `json:"status"`
	UsedTraffic            int64            `json:"used_traffic"`
	LifetimeUsedTraffic    int64            `json:"lifetime_used_traffic"`
	CreatedAt              string           `json:"created_at"`
	Expire                 *int64           `json:"expire"`
	DataLimit              *int64           `json:"data_limit"`
	DataLimitResetStrategy string           `json:"data_limit_reset_strategy,omitempty"`
	OnlineAt               *string          `json:"online_at"`
	ServiceID              *int64           `json:"service_id"`
	ServiceName            *string          `json:"service_name"`
	AdminID                *int64           `json:"admin_id"`
	AdminUsername          *string          `json:"admin_username"`
	Links                  []string         `json:"links"`
	SubscriptionURL        string           `json:"subscription_url"`
	SubscriptionURLs       OrderedStringMap `json:"subscription_urls"`
}

type UsersResponse struct {
	Users           []UserListItem      `json:"users"`
	LinkTemplates   map[string][]string `json:"link_templates"`
	Total           int64               `json:"total"`
	ActiveTotal     *int64              `json:"active_total,omitempty"`
	UsersLimit      *int64              `json:"users_limit,omitempty"`
	StatusBreakdown map[string]int64    `json:"status_breakdown"`
	UsageTotal      *int64              `json:"usage_total,omitempty"`
	OnlineTotal     *int64              `json:"online_total,omitempty"`
}

type UserDetail struct {
	ID                     int64                     `json:"-"`
	Username               string                    `json:"username"`
	CredentialKey          string                    `json:"credential_key,omitempty"`
	KeySubscriptionURL     string                    `json:"key_subscription_url,omitempty"`
	Status                 string                    `json:"status"`
	UsedTraffic            int64                     `json:"used_traffic"`
	LifetimeUsedTraffic    int64                     `json:"lifetime_used_traffic"`
	CreatedAt              string                    `json:"created_at"`
	Expire                 *int64                    `json:"expire"`
	DataLimit              *int64                    `json:"data_limit"`
	DataLimitResetStrategy string                    `json:"data_limit_reset_strategy,omitempty"`
	Flow                   *string                   `json:"flow"`
	Note                   *string                   `json:"note"`
	TelegramID             *string                   `json:"telegram_id"`
	ContactNumber          *string                   `json:"contact_number"`
	SubUpdatedAt           *string                   `json:"sub_updated_at"`
	SubLastUserAgent       *string                   `json:"sub_last_user_agent"`
	OnlineAt               *string                   `json:"online_at"`
	OnHoldExpireDuration   *int64                    `json:"on_hold_expire_duration"`
	OnHoldTimeout          *string                   `json:"on_hold_timeout"`
	IPLimit                int64                     `json:"ip_limit"`
	AutoDeleteInDays       *int64                    `json:"auto_delete_in_days"`
	Subadress              string                    `json:"subadress,omitempty"`
	ServiceID              *int64                    `json:"service_id"`
	ServiceName            *string                   `json:"service_name"`
	AdminID                *int64                    `json:"admin_id"`
	AdminUsername          *string                   `json:"admin_username"`
	Proxies                map[string]map[string]any `json:"proxies"`
	ExcludedInbounds       map[string][]string       `json:"excluded_inbounds"`
	Inbounds               map[string][]string       `json:"inbounds"`
	NextPlan               *NextPlan                 `json:"next_plan"`
	NextPlans              []NextPlan                `json:"next_plans"`
	Links                  []string                  `json:"links"`
	SubscriptionURL        string                    `json:"subscription_url"`
	SubscriptionURLs       OrderedStringMap          `json:"subscription_urls"`
	ServiceHostOrders      map[int64]int             `json:"service_host_orders"`
	Credentials            map[string]string         `json:"credentials,omitempty"`
	LinkData               []map[string]any          `json:"link_data,omitempty"`
}

type OrderedStringMap struct {
	keys   []string
	values map[string]string
}

func NewOrderedStringMap(capacity int) OrderedStringMap {
	if capacity < 0 {
		capacity = 0
	}
	return OrderedStringMap{
		keys:   make([]string, 0, capacity),
		values: make(map[string]string, capacity),
	}
}

func (m *OrderedStringMap) Set(key string, value string) {
	if m.values == nil {
		m.values = map[string]string{}
	}
	if _, exists := m.values[key]; !exists {
		m.keys = append(m.keys, key)
	}
	m.values[key] = value
}

func (m OrderedStringMap) Get(key string) (string, bool) {
	if m.values == nil {
		return "", false
	}
	value, ok := m.values[key]
	return value, ok
}

func (m OrderedStringMap) Without(key string) OrderedStringMap {
	result := NewOrderedStringMap(len(m.keys))
	for _, existingKey := range m.keys {
		if existingKey == key {
			continue
		}
		result.Set(existingKey, m.values[existingKey])
	}
	return result
}

func (m OrderedStringMap) MarshalJSON() ([]byte, error) {
	if len(m.keys) == 0 {
		return []byte(`{}`), nil
	}
	raw := []byte{'{'}
	for i, key := range m.keys {
		if i > 0 {
			raw = append(raw, ',')
		}
		keyBytes, err := json.Marshal(key)
		if err != nil {
			return nil, err
		}
		valueBytes, err := json.Marshal(m.values[key])
		if err != nil {
			return nil, err
		}
		raw = append(raw, keyBytes...)
		raw = append(raw, ':')
		raw = append(raw, valueBytes...)
	}
	raw = append(raw, '}')
	return raw, nil
}

type ProxyConfig struct {
	Type     string         `json:"type"`
	Settings map[string]any `json:"settings"`
}

type StoredProxy struct {
	ID               int64          `json:"id"`
	UserID           int64          `json:"user_id"`
	Type             string         `json:"type"`
	Settings         map[string]any `json:"settings"`
	ExcludedInbounds []string       `json:"excluded_inbounds"`
}

type NextPlan struct {
	ID                  int64  `json:"id"`
	UserID              int64  `json:"user_id"`
	Position            int64  `json:"position"`
	DataLimit           int64  `json:"data_limit"`
	Expire              *int64 `json:"expire"`
	AddRemainingTraffic bool   `json:"add_remaining_traffic"`
	FireOnEither        bool   `json:"fire_on_either"`
	IncreaseDataLimit   bool   `json:"increase_data_limit"`
	StartOnFirstConnect bool   `json:"start_on_first_connect"`
	TriggerOn           string `json:"trigger_on"`
}

type Inbound struct {
	ID  int64  `json:"id"`
	Tag string `json:"tag"`
}

type ResolvedInbound map[string]any

type Host struct {
	ID              int64   `json:"id"`
	InboundTag      string  `json:"inbound_tag"`
	Remark          string  `json:"remark"`
	Address         string  `json:"address"`
	Port            *int64  `json:"port"`
	Sort            int64   `json:"sort"`
	Path            *string `json:"path"`
	SNI             *string `json:"sni"`
	Host            *string `json:"host"`
	Security        string  `json:"security"`
	ALPN            string  `json:"alpn"`
	Fingerprint     string  `json:"fingerprint"`
	AllowInsecure   *bool   `json:"allowinsecure"`
	IsDisabled      bool    `json:"is_disabled"`
	MuxEnable       bool    `json:"mux_enable"`
	FragmentSetting *string `json:"fragment_setting"`
	NoiseSetting    *string `json:"noise_setting"`
	RandomUserAgent bool    `json:"random_user_agent"`
	UseSNIAsHost    bool    `json:"use_sni_as_host"`
	ServiceIDs      []int64 `json:"service_ids,omitempty"`
}

type SubscriptionSettings struct {
	DefaultSubscriptionType string          `json:"default_subscription_type"`
	SubscriptionURLPrefix   string          `json:"subscription_url_prefix"`
	SubscriptionPath        string          `json:"subscription_path"`
	SubscriptionPorts       []int           `json:"subscription_ports"`
	RawPanelSettings        json.RawMessage `json:"raw_panel_settings,omitempty"`
	RawSubscriptionSettings json.RawMessage `json:"raw_subscription_settings,omitempty"`
}

type AdminLinkSettings struct {
	AdminID              int64           `json:"admin_id"`
	SubscriptionDomain   *string         `json:"subscription_domain"`
	SubscriptionSettings json.RawMessage `json:"subscription_settings,omitempty"`
}

type LinkPrerequisites struct {
	RequestOrigin     string                      `json:"request_origin,omitempty"`
	Subscription      SubscriptionSettings        `json:"subscription"`
	Admins            map[int64]AdminLinkSettings `json:"admins"`
	Inbounds          []Inbound                   `json:"inbounds"`
	Hosts             []Host                      `json:"hosts"`
	ServiceHostOrders map[int64]map[int64]int64   `json:"service_host_orders"`
	ProxiesByUser     map[int64][]StoredProxy     `json:"proxies_by_user"`
	NextPlansByUser   map[int64][]NextPlan        `json:"next_plans_by_user"`
}

type SubscriptionLinkRequest struct {
	Username      string `json:"username"`
	CredentialKey string `json:"credential_key,omitempty"`
	Subadress     string `json:"subadress,omitempty"`
	AdminID       *int64 `json:"admin_id,omitempty"`
	Preferred     string `json:"preferred,omitempty"`
	RequestOrigin string `json:"request_origin,omitempty"`
	Salt          string `json:"salt,omitempty"`
}

type SubscriptionLinks struct {
	Primary string           `json:"primary"`
	Links   OrderedStringMap `json:"links"`
}
