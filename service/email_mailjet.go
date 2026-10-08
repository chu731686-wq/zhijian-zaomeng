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

func mailjetConfigured() bool {
	return strings.TrimSpace(config.Cfg.MailjetAPIKey) != "" &&
		strings.TrimSpace(config.Cfg.MailjetSecretKey) != "" &&
		strings.TrimSpace(config.Cfg.MailFrom) != ""
}

func sendMailjetMail(email, code, purpose string) error {
	cfg := config.Cfg
	payload := struct {
		Messages []struct {
			From struct {
				Email string `json:"Email"`
				Name  string `json:"Name"`
			} `json:"From"`
			To       []map[string]string `json:"To"`
			Subject  string              `json:"Subject"`
			HTMLPart string              `json:"HTMLPart"`
		} `json:"Messages"`
	}{Messages: make([]struct {
		From struct {
			Email string `json:"Email"`
			Name  string `json:"Name"`
		} `json:"From"`
		To       []map[string]string `json:"To"`
		Subject  string              `json:"Subject"`
		HTMLPart string              `json:"HTMLPart"`
	}, 1)}
	message := &payload.Messages[0]
	message.From.Email = cfg.MailFrom
	message.From.Name = cfg.MailFromName
	message.To = []map[string]string{{"Email": email}}
	message.Subject = "Verification code"
	message.HTMLPart = fmt.Sprintf("指尖造梦 %s 验证码：<strong>%s</strong><br>10 分钟内有效。如非本人操作，请忽略。", purpose, code)

	body, err := json.Marshal(payload)
	if err != nil {
		return mailjetSafeError(err.Error(), cfg.MailjetAPIKey, cfg.MailjetSecretKey)
	}
	apiBase := strings.TrimRight(strings.TrimSpace(cfg.MailjetAPIBase), "/")
	if apiBase == "" {
		apiBase = "https://api.mailjet.com"
	}
	req, err := http.NewRequest(http.MethodPost, apiBase+"/v3.1/send", bytes.NewReader(body))
	if err != nil {
		return mailjetSafeError(err.Error(), cfg.MailjetAPIKey, cfg.MailjetSecretKey)
	}
	req.SetBasicAuth(cfg.MailjetAPIKey, cfg.MailjetSecretKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return mailjetSafeError(err.Error(), cfg.MailjetAPIKey, cfg.MailjetSecretKey)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var response struct {
		ErrorMessage string `json:"ErrorMessage"`
		Error        string `json:"error"`
		Messages     []struct {
			Status string `json:"Status"`
			Errors []struct {
				ErrorMessage string `json:"ErrorMessage"`
				ErrorCode    string `json:"ErrorCode"`
			} `json:"Errors"`
		} `json:"Messages"`
	}
	_ = json.Unmarshal(data, &response)

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := response.ErrorMessage
		if message == "" {
			message = response.Error
		}
		if message == "" && len(response.Messages) > 0 && len(response.Messages[0].Errors) > 0 {
			message = response.Messages[0].Errors[0].ErrorMessage
		}
		if strings.TrimSpace(message) == "" {
			message = "未提供错误说明"
		}
		return mailjetSafeError(fmt.Sprintf("Mailjet HTTP %d: %s", resp.StatusCode, message), cfg.MailjetAPIKey, cfg.MailjetSecretKey)
	}
	if len(response.Messages) == 0 || !strings.EqualFold(response.Messages[0].Status, "success") {
		message := strings.TrimSpace(response.ErrorMessage)
		if message == "" {
			message = strings.TrimSpace(response.Error)
		}
		if len(response.Messages) > 0 && len(response.Messages[0].Errors) > 0 {
			providerError := response.Messages[0].Errors[0]
			if strings.TrimSpace(providerError.ErrorMessage) != "" {
				message = providerError.ErrorMessage
			} else if strings.TrimSpace(providerError.ErrorCode) != "" {
				message = providerError.ErrorCode
			}
		}
		if message == "" {
			message = "未提供错误说明"
		}
		return mailjetSafeError(fmt.Sprintf("Mailjet HTTP %d: %s", resp.StatusCode, message), cfg.MailjetAPIKey, cfg.MailjetSecretKey)
	}
	return nil
}

func mailjetSafeError(message, apiKey, secretKey string) error {
	if apiKey != "" {
		message = strings.ReplaceAll(message, apiKey, "[redacted]")
	}
	if secretKey != "" {
		message = strings.ReplaceAll(message, secretKey, "[redacted]")
	}
	return fmt.Errorf("%s", message)
}
