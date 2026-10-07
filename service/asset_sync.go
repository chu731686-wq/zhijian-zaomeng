package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/repository"
)

type assetSnapshot struct {
	Assets        []json.RawMessage `json:"assets"`
	DeletedAssets map[string]string `json:"deletedAssets,omitempty"`
}

// A small-team server runs in one process; serialize read/merge/write across clients.
var assetSyncMu sync.Mutex

func SaveCurrentUserAssetData(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var incoming assetSnapshot
	if json.Unmarshal(raw, &incoming) != nil || incoming.Assets == nil {
		return nil, errors.New("素材清单格式无效")
	}
	assetSyncMu.Lock()
	defer assetSyncMu.Unlock()
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	var saved assetSnapshot
	if config.AssetData != "" && json.Unmarshal([]byte(config.AssetData), &saved) != nil {
		return nil, errors.New("服务器素材清单格式无效")
	}
	if saved.DeletedAssets == nil {
		saved.DeletedAssets = map[string]string{}
	}
	for id, stamp := range incoming.DeletedAssets {
		if id == "" {
			return nil, errors.New("素材 ID 无效")
		}
		if _, err := time.Parse(time.RFC3339Nano, stamp); err != nil {
			return nil, errors.New("素材删除时间无效")
		}
		if stamp > saved.DeletedAssets[id] {
			saved.DeletedAssets[id] = stamp
		}
	}
	type entry struct {
		raw   json.RawMessage
		stamp time.Time
	}
	items := map[string]entry{}
	for _, item := range append(saved.Assets, incoming.Assets...) {
		var meta struct {
			ID        string `json:"id"`
			UpdatedAt string `json:"updatedAt"`
		}
		if json.Unmarshal(item, &meta) != nil || meta.ID == "" {
			return nil, errors.New("素材 ID 无效")
		}
		stamp, err := time.Parse(time.RFC3339Nano, meta.UpdatedAt)
		if err != nil {
			return nil, errors.New("素材修改时间无效")
		}
		if _, deleted := saved.DeletedAssets[meta.ID]; deleted {
			continue
		}
		if previous, exists := items[meta.ID]; !exists || !stamp.Before(previous.stamp) {
			items[meta.ID] = entry{item, stamp}
		}
	}
	ids := make([]string, 0, len(items))
	for id := range items {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return items[ids[i]].stamp.After(items[ids[j]].stamp) })
	saved.Assets = make([]json.RawMessage, 0, len(ids))
	for _, id := range ids {
		saved.Assets = append(saved.Assets, items[id].raw)
	}
	result, err := json.Marshal(saved)
	if err != nil {
		return nil, err
	}
	config.AssetData = string(result)
	if config.CreatedAt == "" {
		config.CreatedAt = now()
	}
	_, err = repository.SaveUserConfigFields(config, "asset_data")
	return result, err
}
