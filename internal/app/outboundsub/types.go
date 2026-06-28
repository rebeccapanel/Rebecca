package outboundsub

import "encoding/json"

type Subscription struct {
	ID                   int64           `json:"id"`
	Remark               string          `json:"remark"`
	URL                  string          `json:"url"`
	Enabled              bool            `json:"enabled"`
	AllowPrivate         bool            `json:"allowPrivate"`
	TagPrefix            string          `json:"tagPrefix"`
	UpdateInterval       int             `json:"updateInterval"`
	Priority             int             `json:"priority"`
	Prepend              bool            `json:"prepend"`
	LastUpdated          int64           `json:"lastUpdated"`
	LastError            string          `json:"lastError"`
	LastFetchedOutbounds json.RawMessage `json:"-"`
	LinkIdentities       json.RawMessage `json:"-"`
	CreatedAt            string          `json:"created_at,omitempty"`
	UpdatedAt            string          `json:"updated_at,omitempty"`
	OutboundCount        int             `json:"outboundCount"`
}

type Payload struct {
	Remark         string `json:"remark"`
	URL            string `json:"url"`
	Enabled        *bool  `json:"enabled"`
	AllowPrivate   bool   `json:"allowPrivate"`
	TagPrefix      string `json:"tagPrefix"`
	UpdateInterval int    `json:"updateInterval"`
	Prepend        bool   `json:"prepend"`
}

type MovePayload struct {
	Direction string `json:"dir"`
}

type ParsePayload struct {
	URL          string `json:"url"`
	AllowPrivate bool   `json:"allowPrivate"`
}

type SplitOutbounds struct {
	Prepend []any
	Append  []any
}
