package main

import (
	"log"
	"net/url"
	"strings"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/router"
	"github.com/tigerowo/infinite-canvas/service"
)

func main() {
	if err := config.Load(); err != nil {
		fatal(err)
	}
	if err := service.EnsureDefaultAdmin(); err != nil {
		fatal(err)
	}
	if err := service.EnsureDefaultAgentSkills(); err != nil {
		fatal(err)
	}
	service.StartPromptSyncScheduler()
	service.StartCanvasProjectCleanupScheduler()
	handler.StartVideoTaskPoller()
	log.Fatal(router.New().Run(":" + config.Cfg.Port))
}

// fatal 退出前把数据库地址和各类密码从报错里遮掉，避免写进部署平台日志。
func fatal(err error) {
	log.Fatal(redactSecrets(err.Error()))
}

func redactSecrets(message string) string {
	secrets := []string{config.Cfg.DatabaseDSN, config.Cfg.AdminPassword, config.Cfg.JWTSecret, config.Cfg.ConfigEncryptionKey, config.Cfg.SMTPPass, config.Cfg.GoogleClientSecret, config.Cfg.GithubClientSecret}
	if parsed, err := url.Parse(config.Cfg.DatabaseDSN); err == nil && parsed.User != nil {
		if password, ok := parsed.User.Password(); ok {
			secrets = append(secrets, password)
		}
	} else if at := strings.LastIndex(config.Cfg.DatabaseDSN, ":"); at >= 0 {
		// 地址格式不对时也尽量遮住冒号后面的密码部分
		secrets = append(secrets, strings.SplitN(config.Cfg.DatabaseDSN[at+1:], "@", 2)[0])
	}
	for _, secret := range secrets {
		if len(strings.TrimSpace(secret)) >= 4 {
			message = strings.ReplaceAll(message, secret, "[已隐藏]")
		}
	}
	return message
}
