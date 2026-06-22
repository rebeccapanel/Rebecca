package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	dashboardapp "github.com/rebeccapanel/rebecca/internal/app/dashboard"
	telegrambot "github.com/rebeccapanel/rebecca/internal/app/telegram/bot"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

// botSettingsSource adapts the Telegram repository to the bot's SettingsSource.
type botSettingsSource struct {
	server *Server
}

func (b botSettingsSource) BotSettings(ctx context.Context) (telegrambot.Settings, error) {
	settings, err := b.server.telegramRepo.Settings(ctx)
	if err != nil {
		return telegrambot.Settings{}, err
	}
	token := ""
	if settings.APIToken != nil {
		token = strings.TrimSpace(*settings.APIToken)
	}
	proxy := ""
	if settings.ProxyURL != nil {
		proxy = strings.TrimSpace(*settings.ProxyURL)
	}
	return telegrambot.Settings{
		Enabled:      settings.UseTelegram,
		Token:        token,
		ProxyURL:     proxy,
		AdminChatIDs: settings.AdminChatIDs,
	}, nil
}

// botAuthorizer resolves the admin actor bot mutations run as. It uses the
// configured sudo admin, mirroring the legacy bot which acted with full access.
type botAuthorizer struct {
	server *Server
}

func (b botAuthorizer) Actor(ctx context.Context) (telegrambot.Actor, bool) {
	username := strings.TrimSpace(b.server.cfg.SudoUsername)
	if username == "" {
		return telegrambot.Actor{}, false
	}
	admin, ok, err := b.server.adminRepo.AdminByUsername(ctx, username)
	if err != nil || !ok {
		return telegrambot.Actor{}, false
	}
	return telegrambot.Actor{Username: admin.Username, Admin: admin}, true
}

// botUserService adapts the user service to the bot's UserService, enforcing the
// same Go service permission/limit core as the HTTP API.
type botUserService struct {
	server *Server
}

func (b botUserService) Get(ctx context.Context, username string) (telegrambot.UserView, error) {
	detail, err := b.server.userService.UserGet(ctx, userapp.UserGetRequest{
		Username: username,
		Admin: userapp.AdminContext{
			Username:       "telegram-bot",
			Role:           string(adminapp.RoleFullAccess),
			CanViewTraffic: true,
			CanSortTraffic: true,
		},
	})
	if err != nil {
		return telegrambot.UserView{}, err
	}
	view := telegrambot.UserView{
		Username:        detail.Username,
		Status:          detail.Status,
		UsedTraffic:     detail.UsedTraffic,
		DataLimit:       detail.DataLimit,
		Expire:          detail.Expire,
		OnlineAt:        detail.OnlineAt,
		SubUpdatedAt:    detail.SubUpdatedAt,
		SubscriptionURL: detail.SubscriptionURL,
		Links:           detail.Links,
	}
	if detail.Note != nil {
		view.Note = *detail.Note
	}
	if detail.AdminUsername != nil {
		view.OwnerAdmin = *detail.AdminUsername
	}
	return view, nil
}

func (b botUserService) actorAdmin(actor telegrambot.Actor) (adminapp.Admin, error) {
	admin, ok := actor.Admin.(adminapp.Admin)
	if !ok {
		return adminapp.Admin{}, fmt.Errorf("invalid admin actor")
	}
	return admin, nil
}

func (b botUserService) Delete(ctx context.Context, actor telegrambot.Actor, username string) error {
	admin, err := b.actorAdmin(actor)
	if err != nil {
		return err
	}
	_, err = b.server.userService.DeleteUser(ctx, admin, username)
	return err
}

func (b botUserService) Reset(ctx context.Context, actor telegrambot.Actor, username string) error {
	admin, err := b.actorAdmin(actor)
	if err != nil {
		return err
	}
	_, err = b.server.userService.ResetUser(ctx, admin, username)
	return err
}

func (b botUserService) RevokeSubscription(ctx context.Context, actor telegrambot.Actor, username string) error {
	admin, err := b.actorAdmin(actor)
	if err != nil {
		return err
	}
	_, err = b.server.userService.RevokeUserSubscription(ctx, admin, username)
	return err
}

func (b botUserService) SetStatus(ctx context.Context, actor telegrambot.Actor, username string, status string) error {
	return b.update(ctx, actor, username, map[string]any{"status": status})
}

func (b botUserService) SetNote(ctx context.Context, actor telegrambot.Actor, username string, note string) error {
	return b.update(ctx, actor, username, map[string]any{"note": note})
}

func (b botUserService) update(ctx context.Context, actor telegrambot.Actor, username string, fields map[string]any) error {
	admin, err := b.actorAdmin(actor)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	_, err = b.server.userService.UpdateUser(ctx, admin, username, raw)
	return err
}

// botSystemService adapts the system stats service to the bot's SystemService.
type botSystemService struct {
	server *Server
}

func (b botSystemService) Info(ctx context.Context) (telegrambot.SystemInfo, error) {
	stats, err := b.server.systemStatsService().Stats(ctx, dashboardapp.AdminContext{
		Username: "telegram-bot",
		Role:     string(adminapp.RoleFullAccess),
	})
	if err != nil {
		return telegrambot.SystemInfo{}, err
	}
	return telegrambot.SystemInfo{
		Version:     stats.Version,
		CPUPercent:  stats.CPUUsage,
		MemUsed:     stats.Memory.Current,
		MemTotal:    stats.Memory.Total,
		TotalUsers:  stats.TotalUser,
		ActiveUsers: stats.UsersActive,
		OnlineUsers: stats.OnlineUsers,
	}, nil
}

// runTelegramBot starts the long-polling Telegram admin bot. It idles until
// Telegram is enabled in the dashboard.
func (s *Server) runTelegramBot(ctx context.Context) {
	b := telegrambot.New(telegrambot.Options{
		APIBase:    s.cfg.TelegramAPIBase,
		Settings:   botSettingsSource{server: s},
		Authorizer: botAuthorizer{server: s},
		Users:      botUserService{server: s},
		System:     botSystemService{server: s},
		DB:         s.db,
	})
	b.Run(ctx)
}
