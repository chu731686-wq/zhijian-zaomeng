package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
)

func brevoConfigured() bool {
	return strings.TrimSpace(config.Cfg.BrevoAPIKey) != "" && strings.TrimSpace(config.Cfg.MailFrom) != ""
}

func sendBrevoMail(email, code, purpose string) error {
	cfg := config.Cfg
	payload := struct {
		Sender struct {
			Name  string `json:"name"`
			Email string `json:"email"`
		} `json:"sender"`
		To          []map[string]string `json:"to"`
		Subject     string              `json:"subject"`
		HTMLContent string              `json:"htmlContent"`
	}{
		To:          []map[string]string{{"email": email}},
		Subject:     "Verification code",
		HTMLContent: fmt.Sprintf("指尖造梦 %s 验证码：<strong>%s</strong><br>10 分钟内有效。如非本人操作，请忽略。", purpose, code),
	}
	payload.Sender.Name = cfg.MailFromName
	payload.Sender.Email = cfg.MailFrom

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	apiBase := strings.TrimRight(strings.TrimSpace(cfg.BrevoAPIBase), "/")
	if apiBase == "" {
		apiBase = "https://api.brevo.com"
	}
	req, err := http.NewRequest(http.MethodPost, apiBase+"/v3/smtp/email", bytes.NewReader(body))
	if err != nil {
		return redactBrevoKey(err.Error(), cfg.BrevoAPIKey)
	}
	req.Header.Set("api-key", cfg.BrevoAPIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return redactBrevoKey(err.Error(), cfg.BrevoAPIKey)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		var response struct {
			Message string `json:"message"`
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = json.Unmarshal(data, &response)
		message := strings.TrimSpace(response.Message)
		if message == "" {
			message = "未提供错误说明"
		}
		return fmt.Errorf("Brevo HTTP %d: %s", resp.StatusCode, redactBrevoKey(message, cfg.BrevoAPIKey))
	}
	return nil
}

func redactBrevoKey(message, apiKey string) error {
	if apiKey != "" {
		message = strings.ReplaceAll(message, apiKey, "[redacted]")
	}
	return fmt.Errorf("%s", message)
}
