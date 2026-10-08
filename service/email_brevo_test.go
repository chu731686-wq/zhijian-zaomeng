package service

import (
	"encoding/json"
	"fmt"
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

func TestBrevoEmailCodeDelivery(t *testing.T) {
	const childMarker = "BREVO_EMAIL_TEST_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestBrevoEmailCodeDelivery$", "-test.timeout=40s")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated Brevo email test: %v\n%s", err, output)
		}
		return
	}

	config.Cfg = config.Config{
		StorageDriver: "sqlite",
		DatabaseDSN:   filepath.Join(t.TempDir(), "brevo.db"),
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

	type brevoPayload struct {
		Sender struct {
			Name  string `json:"name"`
			Email string `json:"email"`
		} `json:"sender"`
		To []struct {
			Email string `json:"email"`
		} `json:"to"`
		Subject     string `json:"subject"`
		HTMLContent string `json:"htmlContent"`
		TextContent string `json:"textContent"`
	}

	newServer := func(status int, apiKey, from string, requests *int, payload *brevoPayload) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			*requests++
			if r.Method != http.MethodPost || r.URL.Path != "/v3/smtp/email" {
				t.Errorf("Brevo request = %s %s, want POST /v3/smtp/email", r.Method, r.URL.Path)
			}
			if got := r.Header.Get("api-key"); got != apiKey {
				t.Errorf("api-key header = %q, want configured key", got)
			}
			if err := json.NewDecoder(r.Body).Decode(payload); err != nil {
				t.Errorf("decode Brevo request body: %v", err)
			} else {
				if payload.Sender.Email != from {
					t.Errorf("sender.email = %q, want %q", payload.Sender.Email, from)
				}
				if len(payload.To) != 1 || payload.To[0].Email == "" {
					t.Errorf("to = %#v, want one recipient", payload.To)
				}
				body := payload.HTMLContent + " " + payload.TextContent
				if !regexp.MustCompile(`[0-9]{6}`).MatchString(body) {
					t.Errorf("message body %q does not contain a six-digit verification code", body)
				}
			}
			w.WriteHeader(status)
		}))
	}

	prepareRecipient := func(t *testing.T, suffix string) string {
		t.Helper()
		email := "brevo-" + suffix + "@example.com"
		user := model.User{
			ID: "brevo-" + suffix, Username: "brevo-" + suffix, Email: email,
			Role: model.UserRoleUser, Status: model.UserStatusActive,
		}
		if err := db.Create(&user).Error; err != nil {
			t.Fatalf("create reset-password recipient: %v", err)
		}
		return email
	}

	t.Run("Brevo alone enables email and sends code", func(t *testing.T) {
		var requests int
		var payload brevoPayload
		server := newServer(http.StatusCreated, "brevo-test-secret", "sender@example.com", &requests, &payload)
		defer server.Close()
		config.Cfg.BrevoAPIKey = "brevo-test-secret"
		config.Cfg.BrevoAPIBase = server.URL + "/"
		config.Cfg.MailFrom = "sender@example.com"
		config.Cfg.MailFromName = "指尖造梦"
		config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "", ""

		if !SMTPConfigured() {
			t.Fatal("Brevo-only configuration should enable email")
		}
		email := prepareRecipient(t, "brevo-only")
		result, err := SendEmailCode(email, "reset", "brevo-only-ip")
		if err != nil {
			t.Fatalf("SendEmailCode returned error: %v", err)
		}
		if !result.MailConfigured {
			t.Error("delivery should report email as configured")
		}
		if requests != 1 {
			t.Errorf("Brevo request count = %d, want 1", requests)
		}
		if len(payload.To) == 1 && payload.To[0].Email != email {
			t.Errorf("to.email = %q, want %q", payload.To[0].Email, email)
		}
		if payload.Sender.Name != "指尖造梦" {
			t.Errorf("sender.name = %q, want 指尖造梦", payload.Sender.Name)
		}
	})

	for _, status := range []int{http.StatusBadRequest, http.StatusInternalServerError} {
		t.Run(fmt.Sprintf("Brevo HTTP %d returns safe error", status), func(t *testing.T) {
			var requests int
			var payload brevoPayload
			server := newServer(status, "brevo-error-secret", "sender@example.com", &requests, &payload)
			defer server.Close()
			config.Cfg.BrevoAPIKey = "brevo-error-secret"
			config.Cfg.BrevoAPIBase = server.URL
			config.Cfg.MailFrom = "sender@example.com"
			config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "", ""

			result, err := SendEmailCode(prepareRecipient(t, fmt.Sprintf("status-%d", status)), "reset", fmt.Sprintf("status-%d-ip", status))
			if err == nil {
				t.Fatal("SendEmailCode should return an error for a non-201 Brevo response")
			}
			if strings.Contains(err.Error(), "brevo-error-secret") {
				t.Errorf("error exposes api-key: %v", err)
			}
			if !result.MailConfigured {
				t.Error("delivery should report email as configured")
			}
			if requests != 1 {
				t.Errorf("Brevo request count = %d, want 1", requests)
			}
		})
	}

	t.Run("neither provider configured does not send", func(t *testing.T) {
		var requests int
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			w.WriteHeader(http.StatusCreated)
		}))
		defer server.Close()
		config.Cfg.BrevoAPIKey, config.Cfg.MailFrom = "", ""
		config.Cfg.BrevoAPIBase = server.URL
		config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "", ""

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

	t.Run("Brevo takes precedence when SMTP is also configured", func(t *testing.T) {
		var requests int
		var payload brevoPayload
		server := newServer(http.StatusCreated, "brevo-preferred-secret", "sender@example.com", &requests, &payload)
		defer server.Close()
		config.Cfg.BrevoAPIKey = "brevo-preferred-secret"
		config.Cfg.BrevoAPIBase = server.URL
		config.Cfg.MailFrom = "sender@example.com"
		config.Cfg.SMTPHost, config.Cfg.SMTPFrom = "smtp.invalid", "smtp-sender@example.com"

		if !SMTPConfigured() {
			t.Fatal("email should be enabled when both providers are configured")
		}
		result, err := SendEmailCode(prepareRecipient(t, "both"), "reset", "both-ip")
		if err != nil {
			t.Fatalf("SendEmailCode returned error: %v", err)
		}
		if !result.MailConfigured || requests != 1 {
			t.Errorf("delivery = %#v, Brevo request count = %d; want configured and one Brevo request", result, requests)
		}
	})
}
