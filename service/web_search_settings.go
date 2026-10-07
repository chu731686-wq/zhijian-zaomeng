package service

import (
	"context"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type WebSearchSettings struct {
	Provider   string `json:"provider"`
	APIKey     string `json:"apiKey"`
	Configured bool   `json:"configured"`
}

type WebSearchSettingsInput struct {
	Provider string  `json:"provider"`
	APIKey   *string `json:"apiKey"`
}

func currentWebSearchSetting(ctx context.Context) (model.UserWebSearchSetting, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserWebSearchSetting{}, safeMessageError{message: "请先登录"}
	}
	return repository.GetUserWebSearchSetting(user.ID)
}

func maskedWebSearchSetting(setting model.UserWebSearchSetting) WebSearchSettings {
	cfg := webSearchConfigFromSetting(setting)
	result := WebSearchSettings{Provider: cfg.Provider, Configured: cfg.APIKey != ""}
	if result.Configured {
		suffix := []rune(setting.APIKey)
		// Very short secrets must never be returned in full.
		if len(suffix) > 4 {
			result.APIKey = "••••" + string(suffix[len(suffix)-4:])
		} else {
			result.APIKey = "••••"
		}
	}
	return result
}

func CurrentWebSearchSettings(ctx context.Context) (WebSearchSettings, error) {
	setting, err := currentWebSearchSetting(ctx)
	return maskedWebSearchSetting(setting), err
}

func applyWebSearchSettings(setting model.UserWebSearchSetting, input WebSearchSettingsInput) (model.UserWebSearchSetting, error) {
	if input.Provider != "" && input.Provider != "bocha" && input.Provider != "toutiao" && input.Provider != "bing" {
		return setting, safeMessageError{message: "不支持的联网搜索服务商"}
	}
	if input.APIKey != nil {
		key := strings.TrimSpace(*input.APIKey)
		if key != maskedWebSearchSetting(setting).APIKey {
			setting.APIKey = key
		}
	}
	setting.Provider = webSearchConfigFromSetting(setting).Provider
	return setting, nil
}

func SaveCurrentWebSearchSettings(ctx context.Context, input WebSearchSettingsInput) (WebSearchSettings, error) {
	setting, err := currentWebSearchSetting(ctx)
	if err != nil {
		return WebSearchSettings{}, err
	}
	setting, err = applyWebSearchSettings(setting, input)
	if err != nil {
		return WebSearchSettings{}, err
	}
	err = repository.SaveUserWebSearchSetting(setting)
	return maskedWebSearchSetting(setting), err
}

func TestCurrentWebSearchSettings(ctx context.Context, input WebSearchSettingsInput) error {
	setting, err := currentWebSearchSetting(ctx)
	if err != nil {
		return err
	}
	setting, err = applyWebSearchSettings(setting, input)
	if err != nil {
		return err
	}
	result, err := WebSearch(ctx, webSearchConfigFromSetting(setting), WebSearchRequest{Query: "AI漫剧", MaxResults: 1})
	if err != nil {
		return safeMessageError{message: err.Error()}
	}
	if result.Provider == "bing" && len(result.Results) == 0 {
		return safeMessageError{message: BingSearchUnavailable}
	}
	return nil
}

func CurrentUserWebSearch(ctx context.Context, input WebSearchRequest) (WebSearchResponse, error) {
	setting := model.UserWebSearchSetting{}
	if user, ok := UserFromContext(ctx); ok && user.ID != "" && user.Role != model.UserRoleGuest {
		var err error
		setting, err = repository.GetUserWebSearchSetting(user.ID)
		if err != nil {
			return WebSearchResponse{}, err
		}
	}
	result, err := WebSearch(ctx, webSearchConfigFromSetting(setting), input)
	if err != nil {
		return result, safeMessageError{message: err.Error()}
	}
	return result, nil
}

func CurrentUserWebFetch(ctx context.Context, rawURL string, maxChars int) (title, content string, truncated bool, err error) {
	if user, ok := UserFromContext(ctx); ok && user.ID != "" && user.Role != model.UserRoleGuest {
		if _, err = repository.GetUserWebSearchSetting(user.ID); err != nil {
			return
		}
	}
	title, content, truncated, err = WebFetch(ctx, rawURL, maxChars)
	if err != nil {
		err = safeMessageError{message: err.Error()}
	}
	return
}

// Empty account settings always use the built-in search; Bocha is opt-in by key.
func webSearchConfigFromSetting(setting model.UserWebSearchSetting) WebSearchConfig {
	key := strings.TrimSpace(setting.APIKey)
	provider := "toutiao"
	if key != "" {
		provider = "bocha"
	}
	return WebSearchConfig{Provider: provider, APIKey: key}
}
