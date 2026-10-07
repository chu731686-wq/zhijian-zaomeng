package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

const comfyBridgeLeaseDuration = 90 * time.Second
const comfyBridgeInspectTimeout = 30 * time.Second

var ErrComfyBridgeLeaseLost = repository.ErrComfyBridgeLeaseLost

type ComfyBridgeSummary struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Online       bool           `json:"online"`
	Enabled      bool           `json:"enabled"`
	LastSeenAt   *time.Time     `json:"lastSeenAt,omitempty"`
	Capabilities map[string]any `json:"capabilities,omitempty"`
}

type ComfyBridgeRegistration struct {
	Bridge ComfyBridgeSummary `json:"bridge"`
	Token  string             `json:"token"`
}

type ComfyBridgeJob struct {
	ID             string         `json:"id"`
	Kind           string         `json:"kind"`
	TaskID         string         `json:"taskId,omitempty"`
	BridgeID       string         `json:"bridgeId"`
	Payload        map[string]any `json:"payload"`
	Checkpoint     map[string]any `json:"checkpoint,omitempty"`
	LeaseToken     string         `json:"leaseToken"`
	LeaseExpiresAt time.Time      `json:"leaseExpiresAt"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type ComfyBridgeInspectInput struct {
	BridgeID     string         `json:"bridgeId"`
	WorkflowID   string         `json:"workflowId"`
	WorkflowJSON map[string]any `json:"workflowJson,omitempty"`
	Capability   string         `json:"capability"`
}

type ComfyBridgeInspectResult struct {
	WorkflowJSON  map[string]any               `json:"workflowJson"`
	WorkflowGraph map[string]any               `json:"workflowGraph,omitempty"`
	Fields        []model.WorkflowFieldMapping `json:"fields"`
}

func RegisterComfyBridge(scope, ownerID, name string) (ComfyBridgeRegistration, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return ComfyBridgeRegistration{}, errors.New("请填写 1～80 字的 Bridge 名称")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return ComfyBridgeRegistration{}, err
	}
	token := hex.EncodeToString(secret)
	now := time.Now()
	bridge := model.ComfyBridge{ID: uuid.NewString(), OwnerScope: scope, OwnerID: ownerID, Name: name, TokenHash: comfyBridgeTokenHash(token), Enabled: true, CreatedAt: now, UpdatedAt: now}
	if err := repository.SaveComfyBridge(bridge); err != nil {
		return ComfyBridgeRegistration{}, err
	}
	return ComfyBridgeRegistration{Bridge: comfyBridgeSummary(bridge), Token: token}, nil
}

func ListComfyBridges(scope, ownerID string) ([]ComfyBridgeSummary, error) {
	bridges, err := repository.ListComfyBridges(scope, ownerID)
	if err != nil {
		return nil, err
	}
	result := make([]ComfyBridgeSummary, 0, len(bridges))
	for _, bridge := range bridges {
		result = append(result, comfyBridgeSummary(bridge))
	}
	return result, nil
}

func DeleteComfyBridge(scope, ownerID, id string) error {
	taskIDs, err := repository.DeleteComfyBridge(id, scope, ownerID)
	if err != nil {
		return err
	}
	for _, taskID := range taskIDs {
		if taskID == "" {
			continue
		}
		if err := finishWorkflowTask(taskID, "failed", nil, "Bridge 设备已删除"); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("settle workflow task after deleting Comfy Bridge failed bridge=%s task=%s err=%v", id, taskID, err)
			continue
		}
		if _, err := repository.MarkComfyBridgeRequestCleanupReadyByTaskID(taskID); err != nil {
			log.Printf("mark deleted Comfy Bridge request cleanup failed bridge=%s task=%s err=%v", id, taskID, err)
		}
	}
	WakeVideoTaskPoller()
	return nil
}

func AuthenticateComfyBridge(token string) (model.ComfyBridge, error) {
	if len(token) != 64 {
		return model.ComfyBridge{}, errors.New("Bridge Token 无效")
	}
	bridge, err := repository.GetComfyBridgeByTokenHash(comfyBridgeTokenHash(token))
	if err != nil || !bridge.Enabled {
		return model.ComfyBridge{}, errors.New("Bridge Token 无效")
	}
	return bridge, nil
}

func HeartbeatComfyBridge(bridge model.ComfyBridge, capabilities map[string]any) error {
	data, err := json.Marshal(capabilities)
	if err != nil || len(data) > 16<<20 {
		return errors.New("Bridge 能力信息过大或格式错误")
	}
	now := time.Now()
	bridge.LastSeenAt, bridge.CapabilitiesJSON, bridge.UpdatedAt = &now, string(data), now
	return repository.UpdateComfyBridgeHeartbeat(bridge)
}

func PollComfyBridge(bridge model.ComfyBridge, queue string) (*ComfyBridgeJob, error) {
	if queue != "inspect" {
		queue = "execute"
	}
	if queue == "execute" {
		if _, err := expireComfyBridgeRequests(bridge.ID); err != nil {
			return nil, err
		}
	}
	leaseToken := uuid.NewString()
	leaseExpiresAt := time.Now().Add(comfyBridgeLeaseDuration)
	request, err := repository.ClaimComfyBridgeRequest(
		bridge.ID,
		queue,
		leaseToken,
		leaseExpiresAt,
	)
	if err != nil || request == nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(request.PayloadJSON), &payload); err != nil {
		return nil, err
	}
	var checkpoint map[string]any
	if request.CheckpointJSON != "" {
		if err := json.Unmarshal([]byte(request.CheckpointJSON), &checkpoint); err != nil {
			return nil, err
		}
	}
	return &ComfyBridgeJob{
		ID:             request.ID,
		Kind:           request.Kind,
		TaskID:         request.TaskID,
		BridgeID:       bridge.ID,
		Payload:        payload,
		Checkpoint:     checkpoint,
		LeaseToken:     leaseToken,
		LeaseExpiresAt: leaseExpiresAt,
		CreatedAt:      request.CreatedAt,
	}, nil
}

func expireComfyBridgeRequests(bridgeID string) (bool, error) {
	taskIDs, hasActive, err := repository.ExpireComfyBridgeRequests(bridgeID)
	if err != nil {
		return false, err
	}
	for _, taskID := range taskIDs {
		if taskID == "" {
			continue
		}
		if err := finishWorkflowTask(taskID, "failed", nil, "Bridge 请求超时"); err != nil {
			log.Printf("settle expired Comfy Bridge task failed bridge=%s task=%s err=%v", bridgeID, taskID, err)
			continue
		}
		if _, err := repository.MarkComfyBridgeRequestCleanupReadyByTaskID(taskID); err != nil {
			log.Printf("mark expired Comfy Bridge request cleanup failed bridge=%s task=%s err=%v", bridgeID, taskID, err)
		}
	}
	if len(taskIDs) > 0 {
		WakeVideoTaskPoller()
	}
	return hasActive, nil
}

func RenewComfyBridgeLease(bridge model.ComfyBridge, requestID, leaseToken string, checkpoint map[string]any) (time.Time, bool, error) {
	requestID = strings.TrimSpace(requestID)
	leaseToken = strings.TrimSpace(leaseToken)
	if requestID == "" || leaseToken == "" {
		return time.Time{}, false, errors.New("Bridge 租约参数无效")
	}
	var checkpointJSON *string
	if checkpoint != nil {
		encoded, err := json.Marshal(checkpoint)
		if err != nil || len(encoded) > 64<<10 {
			return time.Time{}, false, errors.New("Bridge 检查点过大或格式错误")
		}
		value := string(encoded)
		checkpointJSON = &value
	}
	leaseExpiresAt := time.Now().Add(comfyBridgeLeaseDuration)
	accepted, err := repository.UpdateComfyBridgeLease(
		requestID,
		bridge.ID,
		leaseToken,
		leaseExpiresAt,
		checkpointJSON,
	)
	return leaseExpiresAt, accepted, err
}

func CompleteComfyBridge(bridge model.ComfyBridge, requestID, leaseToken, status string, result map[string]any, failure string) (bool, error) {
	if status != "succeeded" && status != "failed" {
		return false, errors.New("Bridge 结果状态无效")
	}
	requestID = strings.TrimSpace(requestID)
	leaseToken = strings.TrimSpace(leaseToken)
	if requestID == "" || leaseToken == "" {
		return false, errors.New("Bridge 请求租约无效")
	}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > 128<<20 {
		return false, errors.New("Bridge 结果过大或格式错误")
	}
	request, err := repository.GetComfyBridgeRequest(requestID)
	if err != nil {
		return false, err
	}
	if request.BridgeID != bridge.ID || request.OwnerScope != bridge.OwnerScope || request.OwnerID != bridge.OwnerID {
		return false, fmt.Errorf("%w：请求不存在或无权回传", ErrComfyBridgeLeaseLost)
	}
	var urls []string
	if status == "succeeded" && request.Kind != "inspect_workflow" {
		urls, err = workflowResultURLs(string(encoded))
		if err != nil {
			status, failure = "failed", err.Error()
		}
	}
	accepted, err := repository.CompleteComfyBridgeRequest(
		requestID,
		bridge.ID,
		leaseToken,
		status,
		string(encoded),
		failure,
	)
	if err != nil || !accepted {
		return false, err
	}
	if request.TaskID == "" {
		return true, nil
	}
	if status == "succeeded" {
		if len(urls) == 0 {
			return false, errors.New("Bridge 成功结果缺少产物")
		}
		if err := finishWorkflowTask(request.TaskID, "completed", urls, ""); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
	} else if err := finishWorkflowTask(request.TaskID, "failed", nil, failure); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	return true, nil
}

func ConfirmComfyBridgeResultCleanup(
	bridge model.ComfyBridge,
	requestID, leaseToken string,
) (bool, error) {
	requestID = strings.TrimSpace(requestID)
	leaseToken = strings.TrimSpace(leaseToken)
	if requestID == "" || leaseToken == "" {
		return false, errors.New("Bridge 清理确认参数无效")
	}
	confirmed, err := repository.ConfirmComfyBridgeRequestCleanup(
		requestID,
		bridge.ID,
		leaseToken,
	)
	if err == nil && confirmed {
		WakeVideoTaskPoller()
	}
	return confirmed, err
}

func InspectComfyBridge(ctx context.Context, scope, ownerID string, input ComfyBridgeInspectInput) (ComfyBridgeInspectResult, error) {
	input.BridgeID = strings.TrimSpace(input.BridgeID)
	input.WorkflowID = strings.TrimSpace(input.WorkflowID)
	input.Capability = strings.TrimSpace(input.Capability)
	if input.BridgeID == "" || input.WorkflowID == "" {
		return ComfyBridgeInspectResult{}, errors.New("Bridge 和工作流 ID 不能为空")
	}
	if input.Capability != "image" && input.Capability != "video" && input.Capability != "audio" {
		return ComfyBridgeInspectResult{}, errors.New("工作流用途无效")
	}
	payload := map[string]any{"workflowId": input.WorkflowID, "capability": input.Capability}
	if len(input.WorkflowJSON) > 0 {
		payload["workflowJson"] = input.WorkflowJSON
	}
	request, err := QueueComfyBridge(scope, ownerID, input.BridgeID, "", "inspect_workflow", payload)
	if err != nil {
		return ComfyBridgeInspectResult{}, err
	}
	defer func() {
		if err := repository.DeleteComfyBridgeInspectRequest(request.ID); err != nil {
			log.Printf("delete Comfy Bridge inspect request failed id=%s err=%v", request.ID, err)
		}
	}()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(comfyBridgeInspectTimeout)
	defer timeout.Stop()
	for {
		current, err := repository.GetComfyBridgeRequest(request.ID)
		if err != nil {
			return ComfyBridgeInspectResult{}, err
		}
		switch current.Status {
		case "succeeded":
			var result ComfyBridgeInspectResult
			if err := json.Unmarshal([]byte(current.ResultJSON), &result); err != nil || len(result.WorkflowJSON) == 0 {
				return ComfyBridgeInspectResult{}, errors.New("Bridge 返回的工作流检查结果无效")
			}
			return result, nil
		case "failed":
			return ComfyBridgeInspectResult{}, errors.New(firstNonEmpty(current.Error, "Bridge 检查工作流失败"))
		}
		select {
		case <-ctx.Done():
			return ComfyBridgeInspectResult{}, ctx.Err()
		case <-timeout.C:
			return ComfyBridgeInspectResult{}, errors.New("Bridge 检查工作流超时")
		case <-ticker.C:
		}
	}
}

func QueueComfyBridge(scope, ownerID, bridgeID, taskID, kind string, payload map[string]any) (model.ComfyBridgeRequest, error) {
	bridge, err := repository.GetComfyBridge(bridgeID)
	if err != nil || !bridge.Enabled || bridge.OwnerScope != scope || bridge.OwnerID != ownerID {
		return model.ComfyBridgeRequest{}, errors.New("Bridge 不存在或无权使用")
	}
	if bridge.LastSeenAt == nil || time.Since(*bridge.LastSeenAt) >= 90*time.Second {
		return model.ComfyBridgeRequest{}, errors.New("Bridge 当前离线，请先启动本机程序")
	}
	encoded, err := json.Marshal(payload)
	if err != nil || len(encoded) > 96<<20 {
		return model.ComfyBridgeRequest{}, errors.New("Bridge 请求过大或格式错误")
	}
	now := time.Now()
	expiresAt := now.Add(workflowTaskTimeout)
	if kind == "inspect_workflow" {
		expiresAt = now.Add(comfyBridgeInspectTimeout)
	}
	request := model.ComfyBridgeRequest{ID: uuid.NewString(), BridgeID: bridgeID, OwnerScope: scope, OwnerID: ownerID, TaskID: taskID, Kind: kind, Status: "pending", PayloadJSON: string(encoded), ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now}
	if err := repository.SaveComfyBridgeRequest(request); err != nil {
		return model.ComfyBridgeRequest{}, err
	}
	if taskID != "" {
		WakeVideoTaskPoller()
	}
	return request, nil
}

func comfyBridgeSummary(bridge model.ComfyBridge) ComfyBridgeSummary {
	summary := ComfyBridgeSummary{ID: bridge.ID, Name: bridge.Name, Enabled: bridge.Enabled, LastSeenAt: bridge.LastSeenAt, Online: bridge.Enabled && bridge.LastSeenAt != nil && time.Since(*bridge.LastSeenAt) < 90*time.Second}
	if bridge.CapabilitiesJSON != "" {
		_ = json.Unmarshal([]byte(bridge.CapabilitiesJSON), &summary.Capabilities)
	}
	return summary
}

func comfyBridgeTokenHash(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}
