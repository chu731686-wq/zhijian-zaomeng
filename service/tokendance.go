package service

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

const (
	tokenDanceModelsURL = "https://tokendance.space/gateway/v1/models"
	tokenDanceModelTTL  = 5 * time.Minute
)

var tokenDanceModelCache struct {
	sync.Mutex
	expiresAt time.Time
	protocols map[string][]string
}

func BuildTokenDanceChannelURL(channel model.ModelChannel, path string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/")
	lowerPath := strings.ToLower(path)
	for _, prefix := range []string{"/ark/", "/kling/", "/alibaba/", "/minimax/"} {
		if !strings.HasPrefix(lowerPath, prefix) {
			continue
		}
		if strings.HasSuffix(strings.ToLower(baseURL), "/v1") {
			baseURL = strings.TrimRight(baseURL[:len(baseURL)-len("/v1")], "/")
		}
		break
	}
	return baseURL + path
}

func TokenDanceSupportedProtocols(modelName string) ([]string, error) {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	tokenDanceModelCache.Lock()
	defer tokenDanceModelCache.Unlock()

	if time.Now().Before(tokenDanceModelCache.expiresAt) {
		if protocols, ok := tokenDanceModelCache.protocols[modelName]; ok {
			return append([]string(nil), protocols...), nil
		}
	}

	protocols, err := fetchTokenDanceModelProtocols()
	if err != nil {
		return nil, err
	}
	tokenDanceModelCache.protocols = protocols
	tokenDanceModelCache.expiresAt = time.Now().Add(tokenDanceModelTTL)

	result, ok := protocols[modelName]
	if !ok {
		return nil, errors.New("TokenDance 模型目录中不存在当前模型")
	}
	return append([]string(nil), result...), nil
}

func fetchTokenDanceModelProtocols() (map[string][]string, error) {
	request, err := http.NewRequest(http.MethodGet, tokenDanceModelsURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		return nil, errors.New("读取 TokenDance 模型协议失败")
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("读取 TokenDance 模型协议失败")
	}

	var payload struct {
		Data []struct {
			ID                 string   `json:"id"`
			SupportedProtocols []string `json:"supported_protocols"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return nil, errors.New("TokenDance 模型目录格式错误")
	}

	result := make(map[string][]string, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.ToLower(strings.TrimSpace(item.ID))
		if id != "" {
			result[id] = append([]string(nil), item.SupportedProtocols...)
		}
	}
	return result, nil
}

func TokenDanceRecoveryMessage(action string) string {
	switch strings.TrimSpace(action) {
	case "top_up_balance":
		return "TokenDance 余额不足，请充值后重试"
	case "reauthorize_api_key":
		return "TokenDance API Key 已失效，请重新授权"
	case "api_key_quota":
		return "TokenDance API Key 已达到周期额度，请等待额度刷新或重新授权"
	default:
		return ""
	}
}
