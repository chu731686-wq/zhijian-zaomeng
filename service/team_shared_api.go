package service

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type SharedModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}
type SharedChannel struct {
	ChannelID string         `json:"channel_id"`
	Name      string         `json:"name"`
	Models    []SharedModel  `json:"models"`
	CanUse    bool           `json:"can_use"`
	Config    map[string]any `json:"-"`
	BasePath  string         `json:"base_path"`
}

// Preserve protocol metadata without exposing credentials or the upstream address.
func (channel SharedChannel) MarshalJSON() ([]byte, error) {
	type metadata SharedChannel
	encoded, err := json.Marshal(metadata(channel))
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	for name, value := range channel.Config {
		fields[name] = value
	}
	if err := json.Unmarshal(encoded, &fields); err != nil {
		return nil, err
	}
	return json.Marshal(fields)
}
func sharedChannelSecrets(value any) []string {
	result := []string{}
	switch item := value.(type) {
	case map[string]any:
		for name, field := range item {
			lower := strings.ToLower(name)
			if strings.Contains(lower, "key") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "password") {
				if secret, ok := field.(string); ok && secret != "" {
					result = append(result, secret)
				}
			}
			result = append(result, sharedChannelSecrets(field)...)
		}
	case []any:
		for _, field := range item {
			result = append(result, sharedChannelSecrets(field)...)
		}
	}
	return result
}
func sharedChannelConfig(value any, secrets []string) any {
	switch item := value.(type) {
	case map[string]any:
		result := map[string]any{}
		for name, field := range item {
			lower := strings.ToLower(name)
			if lower == "baseurl" || lower == "base_url" || strings.Contains(lower, "key") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "password") {
				continue
			}
			result[name] = sharedChannelConfig(field, secrets)
		}
		return result
	case []any:
		result := make([]any, len(item))
		for i, field := range item {
			result[i] = sharedChannelConfig(field, secrets)
		}
		return result
	case string:
		for _, secret := range secrets {
			item = redactTeamSecret(item, secret)
		}
		return item
	default:
		return item
	}
}
func unsupportedSharedChannel(channel model.ModelChannel) bool {
	protocol := strings.ToLower(strings.TrimSpace(channel.Protocol))
	return protocol == "runninghub" || protocol == "comfyui"
}

func ownerChannels(ownerID string) ([]model.ModelChannel, error) {
	config, _, err := repository.GetUserConfig(ownerID)
	if err != nil {
		return nil, err
	}
	var data struct {
		Channels []model.ModelChannel `json:"localChannels"`
	}
	if config.ModelConfig != "" {
		err = json.Unmarshal([]byte(config.ModelConfig), &data)
	}
	return data.Channels, err
}
func CurrentSharedChannels(ctx context.Context, id string, ids *[]string) ([]SharedChannel, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := collaborationPermissions(user.ID, id, nil, "")
	if err != nil {
		return nil, err
	}
	if ids != nil {
		if err := requireCollabPermission(p.CanSetTeamAPI); err != nil {
			return nil, err
		}
	}
	channels, err := ownerChannels(p.Team.OwnerID)
	if err != nil {
		return nil, err
	}
	if ids != nil {
		seen := map[string]bool{}
		unique := []string{}
		for _, id := range *ids {
			found := false
			for _, channel := range channels {
				if channel.ID == id {
					if unsupportedSharedChannel(channel) {
						return nil, collabError(400, "这类接口暂不支持开放给团队")
					}
					found = true
					break
				}
			}
			if !found {
				return nil, collabError(400, "接口不存在，请先将模型配置保存到账号")
			}
			if !seen[id] {
				unique = append(unique, id)
				seen[id] = true
			}
		}
		if err := repository.SaveTeamSharedChannels(p.Team.ID, unique); err != nil {
			return nil, err
		}
	}
	shared, err := repository.TeamSharedChannels(id)
	if err != nil {
		return nil, err
	}
	config, _, err := repository.GetUserConfig(p.Team.OwnerID)
	if err != nil {
		return nil, err
	}
	var raw struct {
		Channels []map[string]any `json:"localChannels"`
	}
	if config.ModelConfig != "" {
		if err := json.Unmarshal([]byte(config.ModelConfig), &raw); err != nil {
			return nil, err
		}
	}
	result := []SharedChannel{}
	for _, entry := range shared {
		for _, channel := range channels {
			if channel.ID == entry.ChannelID && !unsupportedSharedChannel(channel) {
				secrets := []string{channel.APIKey, channel.UploadAPIKey}
				metadata := SharedChannel{ChannelID: redactTeamSecret(channel.ID, channel.APIKey), Name: channel.Name, CanUse: p.CanSetTeamAPI || p.Member.CanUseTeamAPI, Models: []SharedModel{}}
				for _, fields := range raw.Channels {
					if fields["id"] == channel.ID {
						secrets = append(secrets, sharedChannelSecrets(fields)...)
						metadata.Config = sharedChannelConfig(fields, secrets).(map[string]any)
						break
					}
				}
				if base, e := url.Parse(channel.BaseURL); e == nil {
					metadata.BasePath = redactTeamSecret(strings.TrimRight(base.EscapedPath(), "/"), channel.APIKey)
				}
				for _, name := range channel.Models {
					kind := "text"
					if isVideoModelName(name) {
						kind = "video"
					} else if isImageModelName(name) {
						kind = "image"
					} else if strings.Contains(strings.ToLower(name), "tts") {
						kind = "audio"
					}
					metadata.Models = append(metadata.Models, SharedModel{ID: redactTeamSecret(name, channel.APIKey), Name: redactTeamSecret(name, channel.APIKey), Type: kind})
				}
				for _, secret := range secrets {
					metadata.ChannelID = redactTeamSecret(metadata.ChannelID, secret)
					metadata.Name = redactTeamSecret(metadata.Name, secret)
					metadata.BasePath = redactTeamSecret(metadata.BasePath, secret)
					for i := range metadata.Models {
						metadata.Models[i].ID = redactTeamSecret(metadata.Models[i].ID, secret)
						metadata.Models[i].Name = redactTeamSecret(metadata.Models[i].Name, secret)
					}
				}
				result = append(result, metadata)
			}
		}
	}
	return result, nil
}

func CurrentTeamAPIUsage(ctx context.Context, id string) ([]model.TeamAPIUsage, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := collaborationPermissions(user.ID, id, nil, "")
	if err != nil {
		return nil, err
	}
	if err := requireCollabPermission(p.CanSetTeamAPI); err != nil {
		return nil, err
	}
	return repository.TeamAPIUsages(id)
}

// Resolve each call against current membership, access policy, sharing and owner configuration.
func SharedProxyChannel(ctx context.Context, teamID, channelID, canvasID string) (model.ModelChannel, string, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return model.ModelChannel{}, "", err
	}
	p, err := collaborationPermissions(user.ID, teamID, nil, "")
	if err != nil {
		return model.ModelChannel{}, "", err
	}
	denied := collabError(403, "不能在此画布使用团队接口")
	shared, err := repository.TeamSharedChannels(teamID)
	if err != nil {
		return model.ModelChannel{}, "", err
	}
	opened := false
	for _, entry := range shared {
		if entry.ChannelID == channelID {
			opened = true
		}
	}
	if !opened || canvasID == "" {
		return model.ModelChannel{}, "", denied
	}
	projects, err := repository.FindCanvasProjects(canvasID)
	if err != nil {
		return model.ModelChannel{}, "", err
	}
	allowed := false
	for _, project := range projects {
		if project.TeamID != nil && *project.TeamID == teamID {
			permission, e := collaborationPermissions(user.ID, teamID, &project, "")
			if e == nil && permission.CanUseTeamAPI {
				allowed = true
				break
			}
		}
	}
	if !allowed {
		return model.ModelChannel{}, "", denied
	}
	channels, err := ownerChannels(p.Team.OwnerID)
	if err != nil {
		return model.ModelChannel{}, "", err
	}
	for _, channel := range channels {
		if channel.ID == channelID && channel.APIKey != "" && channel.BaseURL != "" {
			return channel, user.ID, nil
		}
	}
	return model.ModelChannel{}, "", denied
}
func redactTeamSecret(value, key string) string {
	if key != "" {
		return strings.ReplaceAll(value, key, "[redacted]")
	}
	return value
}

func ProxyTeamAPI(w http.ResponseWriter, r *http.Request, teamID, channelID, path string) error {
	channel, userID, err := SharedProxyChannel(r.Context(), teamID, channelID, r.URL.Query().Get("canvas_id"))
	if err != nil {
		return err
	}
	usage := model.TeamAPIUsage{TeamID: teamID, UserID: userID, ChannelID: channelID, Path: redactTeamSecret(path, channel.APIKey), CreatedAt: time.Now().UTC(), Status: 502}
	defer func() { _ = repository.RecordTeamAPIUsage(usage) }()
	body, err := io.ReadAll(io.LimitReader(r.Body, (129<<20)+1))
	if err != nil || len(body) > 129<<20 {
		usage.Status = 400
		return collabError(400, "请求体无效或过大")
	}
	var input struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(body, &input)
	usage.Model = input.Model
	if mediaType, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mediaType == "multipart/form-data" {
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		for {
			part, e := reader.NextPart()
			if e != nil {
				break
			}
			if part.FormName() == "model" {
				value, _ := io.ReadAll(io.LimitReader(part, 4096))
				usage.Model = string(value)
				break
			}
		}
	}
	usage.Model = redactTeamSecret(usage.Model, channel.APIKey)
	targetURL := strings.TrimRight(channel.BaseURL, "/") + "/" + strings.TrimLeft(path, "/")
	target, err := url.Parse(targetURL)
	if err != nil || target.Host == "" || target.User != nil || (target.Scheme != "http" && target.Scheme != "https") {
		return collabError(502, "接口地址无效")
	}
	query := []string{}
	for _, part := range strings.Split(r.URL.RawQuery, "&") {
		name, _, _ := strings.Cut(part, "=")
		decoded, _ := url.QueryUnescape(name)
		if decoded != "canvas_id" && part != "" {
			query = append(query, part)
		}
	}
	target.RawQuery = strings.Join(query, "&")
	request, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return collabError(502, "接口请求失败")
	}
	// Forward only request headers used by native protocols, never caller credentials/cookies.
	for _, name := range []string{"Content-Type", "Accept", "X-DashScope-Async", "X-App-URL"} {
		if value := r.Header.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	request.Header.Set("Accept-Encoding", "identity")
	SetModelChannelAuthHeader(request, channel)
	client := HTTPClientForChannel(channel)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return collabError(502, "上游接口连接失败")
	}
	defer response.Body.Close()
	usage.Status = response.StatusCode
	var upstream io.Reader = response.Body
	switch strings.ToLower(response.Header.Get("Content-Encoding")) {
	case "gzip":
		reader, err := gzip.NewReader(response.Body)
		if err != nil {
			usage.Status = 502
			return collabError(502, "上游响应格式无效")
		}
		defer reader.Close()
		upstream = reader
		response.Header.Del("Content-Encoding")
	case "deflate":
		reader, err := zlib.NewReader(response.Body)
		if err != nil {
			usage.Status = 502
			return collabError(502, "上游响应格式无效")
		}
		defer reader.Close()
		upstream = reader
		response.Header.Del("Content-Encoding")
	}
	for name, values := range response.Header {
		switch strings.ToLower(name) {
		case "authorization", "proxy-authorization", "x-goog-api-key", "set-cookie", "content-length", "transfer-encoding", "connection", "keep-alive", "trailer", "upgrade":
			continue
		}
		for _, value := range values {
			w.Header().Add(name, redactTeamSecret(value, channel.APIKey))
		}
	}
	w.WriteHeader(response.StatusCode)
	// Keep only a suffix that could be the start of a secret across read boundaries.
	pending := []byte{}
	buffer := make([]byte, 32<<10)
	key := []byte(channel.APIKey)
	for {
		n, readErr := upstream.Read(buffer)
		pending = append(pending, buffer[:n]...)
		pending = []byte(redactTeamSecret(string(pending), channel.APIKey))
		keep := 0
		if readErr == nil {
			for size := 1; size < len(key) && size <= len(pending); size++ {
				if bytes.Equal(pending[len(pending)-size:], key[:size]) {
					keep = size
				}
			}
		}
		end := len(pending) - keep
		if end > 0 {
			if _, err := w.Write(pending[:end]); err != nil {
				return nil
			}
			pending = pending[end:]
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if readErr != nil {
			break
		}
	}
	return nil
}
