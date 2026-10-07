package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

type RunningHubInspectInput struct {
	BaseURL    string `json:"baseUrl"`
	APIKey     string `json:"apiKey"`
	Kind       string `json:"kind"`
	WorkflowID string `json:"workflowId"`
	Title      string `json:"title"`
	Capability string `json:"capability"`
}

func InspectAdminRunningHub(ctx context.Context, index *int, channel model.ModelChannel, input RunningHubInspectInput) (model.WorkflowEntry, error) {
	if channel.Protocol != "runninghub" {
		return model.WorkflowEntry{}, errors.New("渠道不是 RunningHub")
	}
	resolved, err := resolveAdminChannel(index, channel)
	if err != nil {
		return model.WorkflowEntry{}, err
	}
	input.BaseURL, input.APIKey = resolved.BaseURL, resolved.APIKey
	return InspectRunningHub(ctx, input)
}

func InspectRunningHub(ctx context.Context, input RunningHubInspectInput) (model.WorkflowEntry, error) {
	input.WorkflowID = strings.TrimSpace(input.WorkflowID)
	input.APIKey = strings.TrimSpace(input.APIKey)
	if input.WorkflowID == "" || input.APIKey == "" {
		return model.WorkflowEntry{}, errors.New("请填写工作流 ID 和积分 API Key")
	}
	if input.Kind != "workflow" && input.Kind != "app" {
		return model.WorkflowEntry{}, errors.New("工作流类型无效")
	}
	if input.Capability != "image" && input.Capability != "video" && input.Capability != "audio" {
		return model.WorkflowEntry{}, errors.New("工作流用途无效")
	}
	root, err := runningHubBaseURL(input.BaseURL)
	if err != nil {
		return model.WorkflowEntry{}, err
	}
	endpoint, body := "/api/openapi/getJsonApiFormat", map[string]any{"apiKey": input.APIKey, "workflowId": input.WorkflowID}
	if input.Kind == "app" {
		endpoint, body = "/api/webapp/apiCallDemo", map[string]any{"apiKey": input.APIKey, "webappId": input.WorkflowID}
	}
	var response map[string]any
	if err := runningHubRequest(ctx, root+endpoint, body, &response, nil); err != nil {
		return model.WorkflowEntry{}, fmt.Errorf("拉取 RunningHub 参数失败：%w", err)
	}
	if code, ok := runningHubResponseCode(response); ok && code != 0 {
		return model.WorkflowEntry{}, fmt.Errorf("拉取 RunningHub 参数失败：%s", runningHubResponseMessage(response))
	}
	data, ok := response["data"].(map[string]any)
	if !ok {
		return model.WorkflowEntry{}, errors.New("RunningHub 参数响应缺少 data")
	}
	entry := model.WorkflowEntry{Provider: "runninghub", Kind: input.Kind, WorkflowID: input.WorkflowID, Title: strings.TrimSpace(input.Title), Capability: input.Capability, Enabled: true, Fields: []model.WorkflowFieldMapping{}}
	if entry.Title == "" {
		entry.Title = input.WorkflowID
	}
	if input.Kind == "app" {
		entry.Fields = runningHubAppFields(data["nodeInfoList"], input.Capability)
		return entry, nil
	}
	workflow := map[string]any{}
	switch prompt := data["prompt"].(type) {
	case string:
		if err := json.Unmarshal([]byte(prompt), &workflow); err != nil {
			return model.WorkflowEntry{}, errors.New("RunningHub 工作流 JSON 格式错误")
		}
	case map[string]any:
		workflow = prompt
	default:
		return model.WorkflowEntry{}, errors.New("RunningHub 参数响应缺少工作流 JSON")
	}
	entry.WorkflowJSON = workflow
	entry.Fields = discoverWorkflowFields(workflow, input.Capability)
	return entry, nil
}

func runningHubBaseURL(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		value = "https://www.runninghub.cn"
	}
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	for _, suffix := range []string{"/openapi/v2", "/openapi"} {
		if strings.HasSuffix(strings.ToLower(value), suffix) {
			value = value[:len(value)-len(suffix)]
			break
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("RunningHub Base URL 格式错误")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func runningHubRequest(ctx context.Context, endpoint string, payload any, target *map[string]any, capture *AICallLogInput) error {
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	if capture != nil {
		capture.Endpoint, capture.Method = endpoint, http.MethodPost
		capture.Status, capture.RequestBody, capture.ResponseBody = 0, "", ""
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	secret := ""
	if capture != nil {
		if body, ok := payload.(map[string]any); ok {
			secret, _ = body["apiKey"].(string)
		}
		capture.RequestBody = string(workflowLogJSON(string(encoded), secret))
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		return errors.New("上游接口无响应或不可达")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if capture != nil {
		capture.Status = response.StatusCode
		capture.ResponseBody = string(workflowLogJSON(string(data), secret))
	}
	if err != nil || len(data) > 8<<20 {
		return errors.New("上游参数响应过大或读取失败")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("上游返回 HTTP %d", response.StatusCode)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return errors.New("上游参数响应不是有效 JSON")
	}
	return nil
}

func runningHubResponseCode(payload map[string]any) (int, bool) {
	if payload == nil {
		return 0, false
	}
	topCode, topValid := runningHubDirectCode(payload)
	if nested, ok := payload["data"].(map[string]interface{}); ok {
		if nestedCode, nestedValid := runningHubResponseCode(nested); nestedValid {
			// 有些网关把 HTTP 成功包装成顶层 code=0，同时把真实任务状态放在
			// data.code/status；真实任务状态优先，避免把排队任务误判成完成。
			if !topValid || topCode == 0 || nestedCode != 0 {
				return nestedCode, true
			}
		}
	}
	return topCode, topValid
}

func runningHubDirectCode(payload map[string]any) (int, bool) {
	primaryCode := 0
	primaryValid := false
	for _, key := range []string{"code", "statusCode", "status_code"} {
		if value, ok := payload[key]; ok {
			if code, valid := runningHubCode(value); valid {
				if (key == "statusCode" || key == "status_code") && code >= 200 && code < 300 {
					code = 0
				}
				primaryCode, primaryValid = code, true
				break
			}
		}
	}
	for _, key := range []string{"status", "state", "taskStatus", "task_status"} {
		if code, valid := runningHubStatusCode(payload[key]); valid {
			if !primaryValid || primaryCode == 0 || code != 0 {
				return code, true
			}
			break
		}
	}
	if primaryValid {
		return primaryCode, true
	}
	// errorCode=0 通常只是“无错误”标记，不能覆盖 data.status=running。
	for _, key := range []string{"errorCode", "error_code"} {
		if value, ok := payload[key]; ok {
			if code, valid := runningHubCode(value); valid && code != 0 {
				return code, true
			}
		}
	}
	return 0, false
}

func runningHubStatusCode(value interface{}) (int, bool) {
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if text == "" || text == "<nil>" {
		return 0, false
	}
	if numeric, ok := runningHubCode(text); ok {
		switch numeric {
		case 0, 804, 813, 805, 806:
			return numeric, true
		}
	}
	text = strings.NewReplacer("_", "", "-", "", " ", "").Replace(text)
	switch text {
	case "success", "succeeded", "complete", "completed", "done", "finished", "finish", "3":
		return 0, true
	case "queued", "queue", "pending", "waiting", "created", "submitted":
		return 813, true
	case "running", "processing", "executing", "inprogress", "started", "working", "1", "2":
		return 804, true
	case "failed", "failure", "error", "rejected", "cancelled", "canceled", "expired", "aborted", "4", "5":
		return 805, true
	default:
		return 0, false
	}
}

func runningHubCode(value interface{}) (int, bool) {
	switch item := value.(type) {
	case int:
		if item < 0 {
			return 0, false
		}
		return item, true
	case int64:
		if item < 0 {
			return 0, false
		}
		return int(item), true
	case float64:
		code := int(item)
		if item < 0 || float64(code) != item {
			return 0, false
		}
		return code, true
	case json.Number:
		code, err := strconv.Atoi(string(item))
		return code, err == nil && code >= 0
	case string:
		code, err := strconv.Atoi(strings.TrimSpace(item))
		return code, err == nil && code >= 0
	default:
		return 0, false
	}
}

func runningHubResponseMessage(value map[string]any) string {
	for _, key := range []string{"msg", "message", "error", "failReason", "failedReason", "errorMessage"} {
		if text := strings.TrimSpace(fmt.Sprint(value[key])); text != "" && text != "<nil>" {
			return text
		}
	}
	if nested, ok := value["data"].(map[string]any); ok {
		return runningHubResponseMessage(nested)
	}
	return "上游拒绝请求"
}

func runningHubAppFields(raw any, capability string) []model.WorkflowFieldMapping {
	encoded, _ := json.Marshal(normalizeManagementAppFields(raw, capability))
	var fields []model.WorkflowFieldMapping
	_ = json.Unmarshal(encoded, &fields)
	return fields
}

func discoverWorkflowFields(workflow map[string]any, capability string) []model.WorkflowFieldMapping {
	encoded, _ := json.Marshal(collectManagementWorkflowFields(workflow, capability))
	var fields []model.WorkflowFieldMapping
	_ = json.Unmarshal(encoded, &fields)
	return fields
}
