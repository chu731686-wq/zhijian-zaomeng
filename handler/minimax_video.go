package handler

import (
	"encoding/json"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func isMiniMaxH3Channel(channel model.ModelChannel, modelName string) bool {
	return service.IsMiniMaxChannel(channel) && service.IsMiniMaxH3ModelName(modelName)
}

func transformMiniMaxVideoTaskResponse(payload []byte) ([]byte, bool) {
	var root struct {
		Task map[string]any `json:"task"`
	}
	if json.Unmarshal(payload, &root) != nil || root.Task == nil {
		return nil, false
	}
	root.Task["task_id"] = readStringPath(root.Task, "id")
	root.Task["video_url"] = readStringPath(root.Task, "content.url")
	root.Task["size"] = readStringPath(root.Task, "resolution")
	transformed, err := json.Marshal(root.Task)
	return transformed, err == nil
}
