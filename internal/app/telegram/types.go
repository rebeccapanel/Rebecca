package telegram

type TopicSettings struct {
	Title   string `json:"title"`
	TopicID *int64 `json:"topic_id"`
}

type Settings struct {
	APIToken            *string                  `json:"api_token"`
	UseTelegram         bool                     `json:"use_telegram"`
	ProxyURL            *string                  `json:"proxy_url"`
	AdminChatIDs        []int64                  `json:"admin_chat_ids"`
	LogsChatID          *int64                   `json:"logs_chat_id"`
	LogsChatIsForum     bool                     `json:"logs_chat_is_forum"`
	BackupChatID        *int64                   `json:"backup_chat_id"`
	BackupChatIsForum   bool                     `json:"backup_chat_is_forum"`
	DefaultVlessFlow    *string                  `json:"default_vless_flow"`
	ForumTopics         map[string]TopicSettings `json:"forum_topics"`
	EventToggles        map[string]bool          `json:"event_toggles"`
	BackupEnabled       bool                     `json:"backup_enabled"`
	BackupScope         string                   `json:"backup_scope"`
	BackupIntervalValue int                      `json:"backup_interval_value"`
	BackupIntervalUnit  string                   `json:"backup_interval_unit"`
	BackupLastSentAt    *string                  `json:"backup_last_sent_at"`
	BackupLastError     *string                  `json:"backup_last_error"`
	LastSentAt          *string                  `json:"last_sent_at,omitempty"`
	LastError           *string                  `json:"last_error,omitempty"`
	LastErrorAt         *string                  `json:"last_error_at,omitempty"`
}

type TestRequest struct {
	ChatID *int64  `json:"chat_id"`
	Text   *string `json:"text"`
}

type TestResult struct {
	OK     bool   `json:"ok"`
	ChatID int64  `json:"chat_id"`
	Detail string `json:"detail"`
}

type DestinationPurpose string

const (
	DestinationLogs   DestinationPurpose = "logs"
	DestinationBackup DestinationPurpose = "backup"
)

type DestinationRequest struct {
	Purpose  DestinationPurpose
	Category string
	ChatID   *int64
	ThreadID *int64
}

type Destination struct {
	ChatID   int64  `json:"chat_id"`
	ThreadID *int64 `json:"thread_id,omitempty"`
	Source   string `json:"source"`
}

type MessageRequest struct {
	Destination           DestinationRequest
	Text                  string
	ParseMode             string
	DisableWebPagePreview bool
}

type DocumentRequest struct {
	Destination DestinationRequest
	FileName    string
	Content     []byte
	Caption     string
	ParseMode   string
}

type SendResult struct {
	OK         bool   `json:"ok"`
	Method     string `json:"method"`
	ChatID     int64  `json:"chat_id"`
	ThreadID   *int64 `json:"thread_id,omitempty"`
	Part       int    `json:"part"`
	TotalParts int    `json:"total_parts"`
}

type BackupDeliveryResult struct {
	OK       bool         `json:"ok"`
	Filename string       `json:"filename"`
	Scope    string       `json:"scope"`
	Size     int64        `json:"size"`
	Results  []SendResult `json:"results"`
}
