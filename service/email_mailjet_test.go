package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestMailjetEmailCodeDelivery(t *testing.T) {
	const childMarker = "MAILJET_EMAIL_TEST_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestMailjetEmailCodeDelivery$", "-test.timeout=40s")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated Mailjet email test: %v\n%s", err, output)
		}
		return
	}

	config.Cfg = config.Config{
		StorageDriver: "sqlite",
		DatabaseDSN:   filepath.Join(t.TempDir(), "mailjet.db"),
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("open temporary database: %v", err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatalf("get database connection: %v", err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	type mailjetPayload struct {
		Messages []struct {
			From struct {
				Email string `json:"Email"`
				Name  string `json:"Name"`
			} `json:"From"`
			To []struct {
				Email string `json:"Email"`
			} `json:"To"`
			Subject  string `json:"Subject"`
			HTMLPart string `json:"HTMLPart"`
		} `json:"Messages"`
	}

	newServer := func(status int, responseBody, apiKey, secretKey, from string, requests *int, payload *mailjetPayload) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			*requests++
			if r.Method != http.MethodPost || r.URL.Path != "/v3.1/send" {
				t.Errorf("Mailjet request = %s %s, want POST /v3.1/send", r.Method, r.URL.Path)
			}
			username, password, ok := r.BasicAuth()
			if !ok || username != apiKey || password != secretKey {
				t.Errorf("Mailjet Basic authentication = (%q, %q, %t), want configured credentials", username, password, ok)
			}
			if err := json.NewDecoder(r.Body).Decode(payload); err != nil {
				t.Errorf("decode Mailjet request body: %v", err)
			} else if len(payload.Messages) != 1 {
				t.Errorf("Messages count = %d, want 1", len(payload.Messages))
			} else {
				message := payload.Messages[0]
				if message.From.Email != from {
					t.Errorf("From.Email = %q, want %q", message.From.Email, from)
				}
				if len(message.To) != 1 || message.To[0].Email == "" {
					t.Errorf("To = %#v, want one recipient", message.To)
				}
				if !regexp.MustCompile(`[0-9]{6}`).MatchString(message.HTMLPart) {
					t.Errorf("HTMLPart %q does not contain a six-digit verification code", message.HTMLPart)
				}
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte(responseBody))
		}))
	}

	prepareRecipient := func(t *testing.T, suffix string) string {
		t.Helper()
		email := "mailjet-" + suffix + "@example.com"
		user := model.User{
			ID: "mailjet-" + suffix, Username: "mailjet-" + suffix, Email: email,
			Role: model.UserRoleUser, Status: model.UserStatusActive,
		}
		if err := db.Create(&user).Error; err != nil {
			t.Fatalf("create reset-password recipient: %v", err)
		}
		return email
	}

	t.Run("Mailjet alone enables email and sends code", func(t *testing.T) {
		var requests int
		var payload mailjetPayload
		server := newServer(http.StatusOK, `{"Messages":[{"Status":"success"}]}`, "mailjet-test-key", "mailjet-test-secret", "sender@example.com", &requests, &payload)
		defer server.Close()
		config.Cfg.MailjetAPIKey = "mailjet-test-key"
		config.Cfg.MailjetSecretKey = "mailjet-test-secret"
		config.Cfg.MailjetAPIBase = server.URL + "/"
		config.Cfg.MailFrom = "sender@example.com"
		config.Cfg.MailFromName = "指尖造梦"
		config.Cfg.BrevoAPIKey, config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "", "", ""

		if !SMTPConfigured() {
			t.Fatal("Mailjet-only configuration should enable email")
		}
		email := prepareRecipient(t, "mailjet-only")
		result, err := SendEmailCode(email, "reset", "mailjet-only-ip")
		if err != nil {
			t.Fatalf("SendEmailCode returned error: %v", err)
		}
		if !result.MailConfigured {
			t.Error("delivery should report email as configured")
		}
		if requests != 1 {
			t.Errorf("Mailjet request count = %d, want 1", requests)
		}
		if len(payload.Messages) == 1 {
			message := payload.Messages[0]
			if len(message.To) == 1 && message.To[0].Email != email {
				t.Errorf("To.Email = %q, want %q", message.To[0].Email, email)
			}
			if message.From.Name != "指尖造梦" {
				t.Errorf("From.Name = %q, want 指尖造梦", message.From.Name)
			}
		}
	})

	for _, response := range []struct {
		name   string
		status int
		body   string
	}{
		{name: "HTTP 400", status: http.StatusBadRequest, body: `{"error":"mailjet-error-key mailjet-error-secret"}`},
		{name: "HTTP 500", status: http.StatusInternalServerError, body: `{"error":"mailjet-error-key mailjet-error-secret"}`},
		{name: "non-success Mailjet status", status: http.StatusOK, body: `{"Messages":[{"Status":"error"}]}`},
	} {
		t.Run(response.name+" returns safe error", func(t *testing.T) {
			var requests int
			var payload mailjetPayload
			server := newServer(response.status, response.body, "mailjet-error-key", "mailjet-error-secret", "sender@example.com", &requests, &payload)
			defer server.Close()
			config.Cfg.MailjetAPIKey = "mailjet-error-key"
			config.Cfg.MailjetSecretKey = "mailjet-error-secret"
			config.Cfg.MailjetAPIBase = server.URL
			config.Cfg.MailFrom = "sender@example.com"
			config.Cfg.BrevoAPIKey, config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "", "", ""

			result, err := SendEmailCode(prepareRecipient(t, strings.ToLower(strings.ReplaceAll(response.name, " ", "-"))), "reset", "mailjet-error-ip")
			if err == nil {
				t.Fatal("SendEmailCode should return an error for a rejected Mailjet response")
			}
			if strings.Contains(err.Error(), "mailjet-error-key") || strings.Contains(err.Error(), "mailjet-error-secret") {
				t.Errorf("error exposes Mailjet credentials: %v", err)
			}
			if !result.MailConfigured {
				t.Error("delivery should report email as configured")
			}
			if requests != 1 {
				t.Errorf("Mailjet request count = %d, want 1", requests)
			}
		})
	}

	t.Run("neither provider configured does not send", func(t *testing.T) {
		var requests int
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"Messages":[{"Status":"success"}]}`))
		}))
		defer server.Close()
		config.Cfg.MailjetAPIKey, config.Cfg.MailjetSecretKey, config.Cfg.MailFrom = "", "", ""
		config.Cfg.MailjetAPIBase = server.URL
		config.Cfg.BrevoAPIKey, config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "", "", ""

		if SMTPConfigured() {
			t.Fatal("email should be disabled when neither provider is configured")
		}
		result, err := SendEmailCode(prepareRecipient(t, "disabled"), "reset", "disabled-ip")
		if err != nil {
			t.Fatalf("SendEmailCode returned error: %v", err)
		}
		if result.MailConfigured {
			t.Error("delivery should report email as unconfigured")
		}
		if requests != 0 {
			t.Errorf("request count = %d, want 0", requests)
		}
	})

	t.Run("Mailjet takes precedence over SMTP", func(t *testing.T) {
		var requests int
		var payload mailjetPayload
		server := newServer(http.StatusOK, `{"Messages":[{"Status":"success"}]}`, "mailjet-preferred-key", "mailjet-preferred-secret", "sender@example.com", &requests, &payload)
		defer server.Close()
		config.Cfg.MailjetAPIKey = "mailjet-preferred-key"
		config.Cfg.MailjetSecretKey = "mailjet-preferred-secret"
		config.Cfg.MailjetAPIBase = server.URL
		config.Cfg.MailFrom = "sender@example.com"
		config.Cfg.BrevoAPIKey = ""
		config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "smtp.invalid", "smtp-sender@example.com"

		if !SMTPConfigured() {
			t.Fatal("email should be enabled when Mailjet and SMTP are configured")
		}
		result, err := SendEmailCode(prepareRecipient(t, "mailjet-and-smtp"), "reset", "mailjet-and-smtp-ip")
		if err != nil {
			t.Fatalf("SendEmailCode returned error: %v", err)
		}
		if !result.MailConfigured || requests != 1 {
			t.Errorf("delivery = %#v, Mailjet request count = %d; want configured and one Mailjet request", result, requests)
		}
	})

	t.Run("Brevo takes precedence over Mailjet and SMTP", func(t *testing.T) {
		var brevoRequests, mailjetRequests int
		brevoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			brevoRequests++
			if r.Method != http.MethodPost || r.URL.Path != "/v3/smtp/email" {
				t.Errorf("Brevo request = %s %s, want POST /v3/smtp/email", r.Method, r.URL.Path)
			}
			w.WriteHeader(http.StatusCreated)
		}))
		defer brevoServer.Close()
		mailjetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mailjetRequests++
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"Messages":[{"Status":"success"}]}`))
		}))
		defer mailjetServer.Close()
		config.Cfg.BrevoAPIKey = "brevo-preferred-key"
		config.Cfg.BrevoAPIBase = brevoServer.URL
		config.Cfg.MailjetAPIKey = "mailjet-lower-priority-key"
		config.Cfg.MailjetSecretKey = "mailjet-lower-priority-secret"
		config.Cfg.MailjetAPIBase = mailjetServer.URL
		config.Cfg.MailFrom = "sender@example.com"
		config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "smtp.invalid", "smtp-sender@example.com"

		result, err := SendEmailCode(prepareRecipient(t, "brevo-priority"), "reset", "brevo-priority-ip")
		if err != nil {
			t.Fatalf("SendEmailCode returned error: %v", err)
		}
		if !result.MailConfigured || brevoRequests != 1 || mailjetRequests != 0 {
			t.Errorf("delivery = %#v, Brevo request count = %d, Mailjet request count = %d; want configured and Brevo only", result, brevoRequests, mailjetRequests)
		}
	})
}
