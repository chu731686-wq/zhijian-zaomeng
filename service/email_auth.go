package service

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func authMessage(message string) error { return safeMessageError{message: message} }

func authRepositoryError(err error) error {
	for _, known := range []error{repository.ErrEmailCooldown, repository.ErrAuthRateLimit, repository.ErrEmailCode, repository.ErrInvite, repository.ErrEmailTaken} {
		if errors.Is(err, known) {
			return authMessage(known.Error())
		}
	}
	return err
}

func NormalizeAuthEmail(value string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 254 || !strings.Contains(email, "@") {
		return "", authMessage("请输入有效的邮箱地址")
	}
	return email, nil
}

// AuthClientIP 不信任客户端可伪造的转发头；代理部署会共享代理 IP 限额。
func AuthClientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func AuthRate(kind, identity string, window int64, limit int) error {
	key := sha256.Sum256([]byte(kind + "\x00" + identity))
	return authRepositoryError(repository.TakeAuthRate(hex.EncodeToString(key[:]), time.Now().Unix(), window, limit))
}

func checkRegistration() error {
	settings, err := repository.GetSettings()
	if err != nil {
		return err
	}
	settings = normalizeSettings(settings)
	if settings.Public.Auth.AllowRegister != nil && !*settings.Public.Auth.AllowRegister {
		return authMessage("当前未开放注册")
	}
	return nil
}

func validateInvite(value string) (string, error) {
	value = strings.TrimSpace(value)
	if config.Cfg.RegistrationInviteRequired && value == "" {
		return "", authMessage("请输入邀请码")
	}
	if len(value) > 64 {
		return "", authMessage("邀请码无效")
	}
	return value, nil
}

func emailCodeHash(email, purpose, code string) string {
	h := hmac.New(sha256.New, []byte(config.Cfg.JWTSecret))
	h.Write([]byte(email + "\x00" + purpose + "\x00" + code))
	return hex.EncodeToString(h.Sum(nil))
}

func SMTPConfigured() bool {
	return brevoConfigured() || mailjetConfigured() || (strings.TrimSpace(config.Cfg.SMTPHost) != "" && strings.TrimSpace(config.Cfg.SMTPFrom) != "")
}

type EmailCodeDelivery struct {
	MailConfigured bool   `json:"mailConfigured"`
	Message        string `json:"message"`
	RetryAfter     int    `json:"retryAfter"`
}

func SendEmailCode(email, purpose, ip string) (EmailCodeDelivery, error) {
	result := EmailCodeDelivery{MailConfigured: SMTPConfigured(), RetryAfter: 60, Message: "如果邮箱可用于此操作，验证码已发送，10 分钟内有效"}
	if !result.MailConfigured {
		result.Message = "邮件服务还没配置，请联系管理员"
	}
	email, err := NormalizeAuthEmail(email)
	if err != nil {
		return result, err
	}
	if purpose != "register" && purpose != "reset" {
		return result, authMessage("验证码用途无效")
	}
	if purpose == "register" {
		if err := checkRegistration(); err != nil {
			return result, err
		}
	}
	if err := AuthRate("send-ip", ip, 3600, 20); err != nil {
		return result, err
	}
	if err := AuthRate("send-email", email, 3600, 5); err != nil {
		return result, err
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return result, err
	}
	plain := fmt.Sprintf("%06d", n.Int64())
	timestamp := time.Now().Unix()
	code := model.EmailCode{Email: email, Purpose: purpose, Hash: emailCodeHash(email, purpose, plain), SentAt: timestamp, ExpiresAt: timestamp + 600}
	if err := repository.SaveEmailCode(code); err != nil {
		return result, authRepositoryError(err)
	}
	user, exists, err := repository.GetUserByEmail(email)
	if err != nil {
		return result, err
	}
	if purpose == "reset" && (!exists || user.Status != model.UserStatusActive) {
		return result, nil
	}
	if !result.MailConfigured {
		log.Printf("[email-code] purpose=%s email=%s code=%s expires_in=600s", purpose, email, plain)
		return result, nil
	}
	if err := sendAuthMail(email, plain, purpose); err != nil {
		_ = repository.InvalidateEmailCode(code)
		log.Printf("邮件验证码发送失败: %v", err)
		return result, authMessage("邮件发送失败，请联系管理员，60 秒后可重试")
	}
	return result, nil
}

func verifiedEmailCode(email, purpose, plain, ip string) (model.EmailCode, error) {
	if err := AuthRate("verify-ip", ip, 600, 30); err != nil {
		return model.EmailCode{}, err
	}
	if err := AuthRate("verify-email", email, 600, 15); err != nil {
		return model.EmailCode{}, err
	}
	code, err := repository.GetEmailCode(email)
	if err != nil {
		return code, authRepositoryError(err)
	}
	if code.Used || code.ExpiresAt <= time.Now().Unix() || code.Attempts >= 5 || code.Purpose != purpose {
		return code, authRepositoryError(repository.ErrEmailCode)
	}
	if subtle.ConstantTimeCompare([]byte(code.Hash), []byte(emailCodeHash(email, purpose, plain))) != 1 {
		if err := repository.FailEmailCode(code, time.Now().Unix()); err != nil {
			return code, err
		}
		return code, authMessage("验证码错误，连续错 5 次后作废")
	}
	return code, nil
}

func RegisterEmail(username, password, email, plain, invite, ip string) (model.AuthSession, error) {
	if err := checkRegistration(); err != nil {
		return model.AuthSession{}, err
	}
	email, err := NormalizeAuthEmail(email)
	if err != nil {
		return model.AuthSession{}, err
	}
	code, err := verifiedEmailCode(email, "register", plain, ip)
	if err != nil {
		return model.AuthSession{}, err
	}
	invite, err = validateInvite(invite)
	if err != nil {
		return model.AuthSession{}, err
	}
	username = strings.TrimSpace(username)
	if username == "" || len(username) > 64 || strings.ContainsAny(username, "@ \t\r\n") {
		return model.AuthSession{}, authMessage("用户名需为 1–64 字符，不能含空格或 @")
	}
	if _, exists, err := repository.GetUserByUsername(username); err != nil {
		return model.AuthSession{}, err
	} else if exists {
		return model.AuthSession{}, authMessage("用户名已存在")
	}
	if err := validateNewPassword(password); err != nil {
		return model.AuthSession{}, err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return model.AuthSession{}, err
	}
	user := model.User{ID: newID("user"), Username: username, Password: hash, Email: email, EmailKey: &email, AffCode: newAffCode(), Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: now(), UpdatedAt: now(), LastLoginAt: now()}
	if err := repository.RegisterVerifiedUser(user, invite, &code, time.Now().Unix()); err != nil {
		return model.AuthSession{}, authRepositoryError(err)
	}
	return newSession(user)
}

func validateNewPassword(password string) error {
	if len(password) < 8 || len(password) > 72 {
		return authMessage("密码需为 8–72 字节")
	}
	return nil
}

func ResetEmailPassword(email, plain, password, ip string) (model.AuthSession, error) {
	email, err := NormalizeAuthEmail(email)
	if err != nil {
		return model.AuthSession{}, err
	}
	code, err := verifiedEmailCode(email, "reset", plain, ip)
	if err != nil {
		return model.AuthSession{}, err
	}
	if err := validateNewPassword(password); err != nil {
		return model.AuthSession{}, err
	}
	user, exists, err := repository.GetUserByEmail(email)
	if err != nil {
		return model.AuthSession{}, err
	}
	if !exists || user.Status != model.UserStatusActive {
		return model.AuthSession{}, authRepositoryError(repository.ErrEmailCode)
	}
	hash, err := hashPassword(password)
	if err != nil {
		return model.AuthSession{}, err
	}
	user, err = repository.ResetVerifiedPassword(user.ID, hash, now(), code, time.Now().Unix())
	if err != nil {
		return model.AuthSession{}, authRepositoryError(err)
	}
	return newSession(user)
}

func CreateInvite(adminID string) (model.RegistrationInvite, error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return model.RegistrationInvite{}, err
	}
	invite := model.RegistrationInvite{Code: hex.EncodeToString(data), CreatedAt: now(), CreatedBy: adminID}
	return invite, repository.CreateRegistrationInvite(invite)
}

func ListInvites() ([]model.RegistrationInvite, error) { return repository.ListRegistrationInvites() }
func RevokeInvite(code string) error {
	return authRepositoryError(repository.RevokeRegistrationInvite(code))
}

func sendAuthMail(email, code, purpose string) error {
	cfg := config.Cfg
	if brevoConfigured() {
		return sendBrevoMail(email, code, purpose)
	}
	if mailjetConfigured() {
		return sendMailjetMail(email, code, purpose)
	}
	from, err := mail.ParseAddress(cfg.SMTPFrom)
	if err != nil {
		return err
	}
	address := net.JoinHostPort(cfg.SMTPHost, cfg.SMTPPort)
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	tlsConfig := &tls.Config{ServerName: cfg.SMTPHost, MinVersion: tls.VersionTLS12}
	if cfg.SMTPPort == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
	} else {
		conn, err = dialer.Dial("tcp", address)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	client, err := smtp.NewClient(conn, cfg.SMTPHost)
	if err != nil {
		return err
	}
	defer client.Close()
	if cfg.SMTPPort != "465" {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsConfig); err != nil {
				return err
			}
		} else if ip := net.ParseIP(cfg.SMTPHost); cfg.SMTPHost != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return errors.New("SMTP 服务需要支持 STARTTLS 或使用 465 端口")
		}
	}
	if cfg.SMTPUser != "" || cfg.SMTPPass != "" {
		if err := client.Auth(smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPHost)); err != nil {
			return err
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return err
	}
	if err := client.Rcpt(email); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "From: %s\r\nTo: %s\r\nSubject: Verification code\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n指尖造梦 %s 验证码：%s\r\n10 分钟内有效。如非本人操作，请忽略。\r\n", from.Address, email, purpose, code)
	if err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
