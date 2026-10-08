package config

import (
	"crypto/rand"
	"encoding/base64"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	UploadDir                  string `env:"UPLOAD_DIR" envDefault:"data/uploads"`
	RegistrationInviteRequired bool   `env:"REGISTRATION_INVITE_REQUIRED" envDefault:"true"`
	SMTPHost                   string `env:"SMTP_HOST"`
	SMTPPort                   string `env:"SMTP_PORT" envDefault:"587"`
	SMTPUser                   string `env:"SMTP_USER"`
	SMTPPass                   string `env:"SMTP_PASS"`
	SMTPFrom                   string `env:"SMTP_FROM"`
	BrevoAPIKey                string `env:"BREVO_API_KEY"`
	BrevoAPIBase               string `env:"BREVO_API_BASE" envDefault:"https://api.brevo.com"`
	MailjetAPIKey              string `env:"MAILJET_API_KEY"`
	MailjetSecretKey           string `env:"MAILJET_SECRET_KEY"`
	MailjetAPIBase             string `env:"MAILJET_API_BASE" envDefault:"https://api.mailjet.com"`
	MailFrom                   string `env:"MAIL_FROM"`
	MailFromName               string `env:"MAIL_FROM_NAME" envDefault:"指尖造梦"`
	GoogleClientID             string `env:"GOOGLE_CLIENT_ID"`
	GoogleClientSecret         string `env:"GOOGLE_CLIENT_SECRET"`
	GoogleRedirectURL          string `env:"GOOGLE_REDIRECT_URL"`
	GithubClientID             string `env:"GITHUB_CLIENT_ID"`
	GithubClientSecret         string `env:"GITHUB_CLIENT_SECRET"`
	GithubRedirectURL          string `env:"GITHUB_REDIRECT_URL"`
	Port                       string `env:"PORT" envDefault:"8080"`
	AdminUsername              string `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPassword              string `env:"ADMIN_PASSWORD" envDefault:"infinite-canvas"`
	JWTSecret                  string `env:"JWT_SECRET" envDefault:"infinite-canvas"`
	ConfigEncryptionKey        string `env:"CONFIG_ENCRYPTION_KEY"`
	JWTExpireHours             int    `env:"JWT_EXPIRE_HOURS" envDefault:"168"`
	StorageDriver              string `env:"STORAGE_DRIVER" envDefault:"sqlite"`
	DatabaseDSN                string `env:"DATABASE_DSN" envDefault:"data/infinite-canvas.db"`
	LinuxDoAuthorizeURL        string `env:"LINUX_DO_AUTHORIZE_URL" envDefault:"https://connect.linux.do/oauth2/authorize"`
	LinuxDoTokenURL            string `env:"LINUX_DO_TOKEN_URL" envDefault:"https://connect.linux.do/oauth2/token"`
	LinuxDoUserInfoURL         string `env:"LINUX_DO_USERINFO_URL" envDefault:"https://connect.linux.do/api/user"`
	AILogDir                   string `env:"AI_LOG_DIR" envDefault:"data/logs/ai-calls"`
}

var Cfg Config

func Load() error {
	_ = godotenv.Load()
	if err := env.Parse(&Cfg); err != nil {
		return err
	}
	if strings.TrimSpace(Cfg.ConfigEncryptionKey) == "" {
		Cfg.ConfigEncryptionKey = Cfg.JWTSecret
		log.Println("WARNING: CONFIG_ENCRYPTION_KEY is unset; deriving the model config encryption key from the configured JWT_SECRET")
	}
	normalizeDockerSQLiteDSN("/app/data")
	if _, err := os.Stat("/app/data"); err == nil && Cfg.UploadDir == "data/uploads" {
		Cfg.UploadDir = "/app/data/uploads"
	}
	if strings.TrimSpace(Cfg.JWTSecret) == "" || Cfg.JWTSecret == "infinite-canvas" {
		secret, err := randomSecret()
		if err != nil {
			return err
		}
		Cfg.JWTSecret = secret
	}
	return nil
}

func normalizeDockerSQLiteDSN(appDataDir string) {
	driver := strings.ToLower(strings.TrimSpace(Cfg.StorageDriver))
	if driver != "" && driver != "sqlite" {
		return
	}
	dsn := strings.TrimSpace(Cfg.DatabaseDSN)
	if dsn == "" || dsn == ":memory:" || strings.HasPrefix(dsn, "file:") {
		return
	}
	pathPart, suffix := dsn, ""
	if index := strings.Index(dsn, "?"); index >= 0 {
		pathPart = dsn[:index]
		suffix = dsn[index:]
	}
	if filepath.IsAbs(pathPart) {
		return
	}
	slashPath := filepath.ToSlash(pathPart)
	if slashPath != "data" && !strings.HasPrefix(slashPath, "data/") {
		return
	}
	if _, err := os.Stat(appDataDir); err != nil {
		return
	}
	Cfg.DatabaseDSN = filepath.Join(filepath.Dir(appDataDir), filepath.FromSlash(slashPath)) + suffix
}

func randomSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
