package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

var errRunningHubTaskTerminal = errors.New("RunningHub 任务已终止")

func SubmitRunningHubTask(ctx context.Context, channel model.ModelChannel, entry model.WorkflowEntry, input WorkflowRunInput, overrides []WorkflowOverride, capture *AICallLogInput) (string, error) {
	root, err := runningHubBaseURL(channel.BaseURL)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(channel.APIKey) == "" {
		return "", errors.New("RunningHub 积分 API Key 未配置")
	}
	uploaded := map[string]string{}
	nodeInfo := make([]map[string]string, 0, len(overrides))
	fieldByID := make(map[string]model.WorkflowFieldMapping, len(entry.Fields))
	for _, field := range entry.Fields {
		fieldByID[field.NodeID+"::"+field.FieldName] = field
	}
	for _, field := range overrides {
		if capture != nil {
			capture.Endpoint, capture.Method = "", ""
			capture.Status, capture.RequestBody, capture.ResponseBody = 0, "", ""
		}
		mapping := fieldByID[field.NodeID+"::"+field.FieldName]
		value := field.Value
		if media, ok := value.(map[string]any); ok {
			mediaID, _ := media["mediaId"].(string)
			if mediaID == "" {
				return "", fmt.Errorf("字段 %s.%s 的媒体引用无效", field.NodeID, field.FieldName)
			}
			name := uploaded[mediaID]
			if name == "" {
				source, err := workflowMediaSource(input, mediaID)
				if err != nil {
					return "", err
				}
				name, err = uploadRunningHubReference(ctx, root, channel.UploadAPIKey, source, capture)
				if err != nil {
					return "", err
				}
				uploaded[mediaID] = name
			}
			value = name
		}
		encodedValue := runningHubScalarString(value)
		if !shouldSendRunningHubWorkflowField(entry.WorkflowJSON, mapping, encodedValue) {
			continue
		}
		nodeInfo = append(nodeInfo, map[string]string{"nodeId": field.NodeID, "fieldName": field.FieldName, "fieldValue": encodedValue})
	}
	endpoint := "/task/openapi/create"
	body := map[string]any{"apiKey": channel.APIKey, "workflowId": entry.WorkflowID}
	if len(nodeInfo) > 0 {
		body["nodeInfoList"] = nodeInfo
	}
	if entry.Kind == "app" {
		endpoint = "/task/openapi/ai-app/run"
		delete(body, "workflowId")
		body["webappId"] = entry.WorkflowID
	}
	var response map[string]any
	if err := runningHubRequest(ctx, root+endpoint, body, &response, capture); err != nil {
		return "", fmt.Errorf("RunningHub 提交失败：%w", err)
	}
	if code, valid := runningHubDirectCode(response); valid && code != 0 {
		return "", fmt.Errorf("RunningHub 提交失败：%s", runningHubResponseMessage(response))
	}
	taskID := runningHubTaskID(response)
	if taskID == "" {
		return "", errors.New("RunningHub 提交未返回 taskId")
	}
	return taskID, nil
}

func runningHubScalarString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if value == nil {
		return ""
	}
	encoded, err := json.Marshal(value)
	if err == nil {
		return string(encoded)
	}
	return fmt.Sprint(value)
}

func shouldSendRunningHubWorkflowField(workflow map[string]any, field model.WorkflowFieldMapping, encoded string) bool {
	if len(workflow) == 0 {
		return true
	}
	node, ok := workflow[strings.TrimSpace(field.NodeID)].(map[string]any)
	if !ok {
		return true
	}
	inputs, ok := node["inputs"].(map[string]any)
	if !ok {
		return true
	}
	original, exists := inputs[strings.TrimSpace(field.FieldName)]
	if exists && isWorkflowLinkValue(original) {
		return false
	}
	if field.Source != "" || field.BindPrompt || field.SourceFromUpstream || field.RandomEnabled {
		if field.SourceAutomatic != nil && !*field.SourceAutomatic {
			return true
		}
		classType := strings.ToLower(strings.TrimSpace(stringValue(node["class_type"])))
		source := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(field.Source))
		return classType != "imageresize+" || source != "size" && source != "imagesize" && source != "sizewidth" && source != "width" && source != "imagewidth" && source != "videowidth" && source != "sizeheight" && source != "height" && source != "imageheight" && source != "videoheight"
	}
	if !exists {
		return true
	}
	return encoded != runningHubScalarString(original)
}

func PollRunningHubTask(ctx context.Context, channel model.ModelChannel, taskID string, capture *AICallLogInput) ([]string, bool, error) {
	root, err := runningHubBaseURL(channel.BaseURL)
	if err != nil {
		return nil, false, fmt.Errorf("%w: %v", errRunningHubTaskTerminal, err)
	}
	requestCapture := capture
	if requestCapture == nil {
		requestCapture = &AICallLogInput{}
	}
	var response map[string]any
	if err := runningHubRequest(ctx, root+"/task/openapi/outputs", map[string]any{"apiKey": channel.APIKey, "taskId": taskID}, &response, requestCapture); err != nil {
		if requestCapture.Status >= 400 && requestCapture.Status < 500 && requestCapture.Status != http.StatusTooManyRequests {
			return nil, false, fmt.Errorf("%w: %v", errRunningHubTaskTerminal, err)
		}
		return nil, false, err
	}
	code, valid := runningHubResponseCode(response)
	if !valid && len(runningHubOutputURLs(response["data"])) == 0 {
		return nil, false, errors.New("RunningHub 查询响应缺少状态和产物")
	}
	switch code {
	case 805, 806:
		return nil, false, fmt.Errorf("%w: %s", errRunningHubTaskTerminal, runningHubResponseMessage(response))
	case 804, 813:
		return nil, false, nil
	}
	if code != 0 {
		return nil, false, nil
	}
	urls := runningHubOutputURLs(response["data"])
	if len(urls) == 0 {
		return nil, false, fmt.Errorf("%w: RunningHub 任务完成但没有返回产物", errRunningHubTaskTerminal)
	}
	for index, value := range urls {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme == "javascript" {
			return nil, false, fmt.Errorf("%w: RunningHub 产物 URL 无效", errRunningHubTaskTerminal)
		}
		if strings.HasPrefix(value, "//") {
			urls[index] = "https:" + value
		} else if !parsed.IsAbs() {
			urls[index] = root + "/" + strings.TrimLeft(value, "/")
		} else if strings.EqualFold(parsed.Host, "rh-images-1252422369.cos.ap-beijing.myqcloud.com") {
			parsed.Host = "rh-images.xiaoyaoyou.com"
			urls[index] = parsed.String()
		}
	}
	return urls, true, nil
}

func runningHubTaskID(value map[string]any) string {
	for _, item := range []any{value["data"], value} {
		if data, ok := item.(map[string]any); ok {
			for _, key := range []string{"taskId", "task_id", "taskID", "id"} {
				if text := stringValue(data[key]); text != "" {
					return text
				}
			}
		}
	}
	return ""
}

func runningHubOutputURLs(value any) []string {
	found := []string{}
	var walk func(any)
	walk = func(raw any) {
		switch item := raw.(type) {
		case string:
			if strings.HasPrefix(item, "http://") || strings.HasPrefix(item, "https://") || strings.HasPrefix(item, "data:") || strings.HasPrefix(item, "/") && !strings.HasPrefix(item, "//") || runningHubRelativeOutputPath(item) {
				found = append(found, item)
			}
		case []any:
			for _, child := range item {
				walk(child)
			}
		case map[string]any:
			keys := make([]string, 0, len(item))
			for key := range item {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				switch strings.ToLower(strings.TrimSpace(key)) {
				case "fileurl", "file_url", "url", "downloadurl", "download_url", "src", "output", "outputs", "results", "files", "data", "images", "videos", "audio", "audios", "result":
					walk(item[key])
				}
			}
		}
	}
	walk(value)
	seen := map[string]bool{}
	unique := make([]string, 0, len(found))
	for _, item := range found {
		if !seen[item] {
			seen[item] = true
			unique = append(unique, item)
		}
	}
	return unique
}

func runningHubRelativeOutputPath(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || strings.Contains(value, "://") || strings.HasPrefix(value, "//") {
		return false
	}
	for _, segment := range strings.Split(strings.Split(value, "?")[0], "/") {
		if segment == ".." {
			return false
		}
	}
	for _, prefix := range []string{"output/", "assets/", "input/"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	for _, suffix := range []string{".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".ogg", ".m4a", ".flac"} {
		if strings.HasSuffix(strings.Split(value, "?")[0], suffix) {
			return true
		}
	}
	return false
}

func workflowMediaSource(input WorkflowRunInput, id string) (string, error) {
	if id == "mask" && input.Mask != "" {
		return input.Mask, nil
	}
	parts := strings.Split(id, ":")
	if len(parts) != 2 {
		return "", errors.New("媒体引用格式无效")
	}
	index, err := strconv.Atoi(parts[1])
	if err != nil || index < 0 {
		return "", errors.New("媒体索引无效")
	}
	var items []string
	switch parts[0] {
	case "image":
		items = input.ReferenceImages
	case "video":
		items = input.ReferenceVideos
	case "audio":
		items = input.ReferenceAudios
	default:
		return "", errors.New("媒体类型无效")
	}
	if index >= len(items) {
		return "", errors.New("媒体索引超出素材数量")
	}
	return items[index], nil
}

func uploadRunningHubReference(ctx context.Context, root, apiKey, raw string, capture *AICallLogInput) (string, error) {
	if capture != nil {
		capture.Endpoint, capture.Method = root+"/task/openapi/upload", http.MethodPost
		capture.Status, capture.RequestBody, capture.ResponseBody = 0, "", ""
	}
	if strings.TrimSpace(apiKey) == "" {
		return "", errors.New("参考素材上传需要 RunningHub 企业级 API Key")
	}
	data, mimeType, err := readWorkflowMedia(ctx, raw)
	if err != nil {
		return "", err
	}
	if len(data) > 30<<20 {
		return "", errors.New("RunningHub 上传素材不能超过 30MB")
	}
	if capture != nil {
		logged, _ := json.Marshal(map[string]any{"fileType": "input", "contentType": mimeType, "size": len(data)})
		capture.RequestBody = string(logged)
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("apiKey", apiKey)
	_ = writer.WriteField("fileType", "input")
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": "workflow-input" + workflowExtension(mimeType)}))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, root+"/task/openapi/upload", body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		return "", errors.New("RunningHub 素材上传接口不可达")
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if capture != nil {
		capture.Status = response.StatusCode
		capture.ResponseBody = string(workflowLogJSON(string(encoded), apiKey))
	}
	if err != nil || len(encoded) > 2<<20 || response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("RunningHub 素材上传失败 HTTP %d", response.StatusCode)
	}
	var parsed map[string]any
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return "", errors.New("RunningHub 素材上传响应无效")
	}
	if code, valid := runningHubResponseCode(parsed); valid && code != 0 {
		return "", errors.New(runningHubResponseMessage(parsed))
	}
	for _, container := range []any{parsed, parsed["data"]} {
		if data, ok := container.(map[string]any); ok {
			for _, key := range []string{"fileName", "file_name", "filename", "name"} {
				if name := stringValue(data[key]); name != "" {
					return name, nil
				}
			}
		}
	}
	return "", errors.New("RunningHub 上传响应缺少 fileName")
}

func readWorkflowMedia(ctx context.Context, raw string) ([]byte, string, error) {
	if strings.HasPrefix(raw, "data:") {
		comma := strings.IndexByte(raw, ',')
		if comma < 0 {
			return nil, "", errors.New("素材 data URL 无效")
		}
		mimeType := strings.Split(strings.TrimPrefix(raw[:comma], "data:"), ";")[0]
		data, err := base64.StdEncoding.DecodeString(raw[comma+1:])
		if err != nil || len(data) == 0 || len(data) > 64<<20 {
			return nil, "", errors.New("素材编码无效或超过 64MB")
		}
		return data, mimeType, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" {
		return nil, "", errors.New("参考素材只接受 data URL 或 HTTPS 链接")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, "", err
	}
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		return nil, "", errors.New("参考素材下载失败")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("参考素材下载失败 HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (64<<20)+1))
	if err != nil || len(data) > 64<<20 {
		return nil, "", errors.New("参考素材超过 64MB")
	}
	return data, strings.Split(response.Header.Get("Content-Type"), ";")[0], nil
}

func workflowExtension(mimeType string) string {
	switch strings.ToLower(mimeType) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	default:
		return ".bin"
	}
}
