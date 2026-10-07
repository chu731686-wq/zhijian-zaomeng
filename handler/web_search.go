package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func requireWebSearchUser(w http.ResponseWriter, r *http.Request) bool {
	user, ok := service.UserFromContext(r.Context())
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		FailWithStatus(w, http.StatusUnauthorized, "请先登录")
		return false
	}
	return true
}

func WebSearchSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		settings, err := service.CurrentWebSearchSettings(r.Context())
		if err != nil {
			FailError(w, err)
			return
		}
		OK(w, settings)
		return
	}
	var input service.WebSearchSettingsInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
		Fail(w, "联网搜索设置无效")
		return
	}
	settings, err := service.SaveCurrentWebSearchSettings(r.Context(), input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, settings)
}

func TestWebSearchSettings(w http.ResponseWriter, r *http.Request) {
	var input service.WebSearchSettingsInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
		Fail(w, "联网搜索设置无效")
		return
	}
	if err := service.TestCurrentWebSearchSettings(r.Context(), input); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]bool{"connected": true})
}

func WebSearch(w http.ResponseWriter, r *http.Request) {
	if !requireWebSearchUser(w, r) {
		return
	}
	var input service.WebSearchRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&input); err != nil {
		Fail(w, "搜索参数无效")
		return
	}
	result, err := service.CurrentUserWebSearch(r.Context(), input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func WebFetch(w http.ResponseWriter, r *http.Request) {
	if !requireWebSearchUser(w, r) {
		return
	}
	var input struct {
		URL      string `json:"url"`
		MaxChars int    `json:"max_chars"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
		Fail(w, "网页读取参数无效")
		return
	}
	title, content, truncated, err := service.CurrentUserWebFetch(r.Context(), input.URL, input.MaxChars)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"url": input.URL, "title": title, "content": content, "truncated": truncated, "fetched_at": time.Now().UTC().Format(time.RFC3339)})
}
