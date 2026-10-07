package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func RunningHubInspect(w http.ResponseWriter, r *http.Request) {
	var input service.RunningHubInspectInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		Fail(w, "请求参数无效")
		return
	}
	entry, err := service.InspectRunningHub(r.Context(), input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, entry)
}

func AdminRunningHubInspect(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Index   *int                           `json:"index"`
		Channel model.ModelChannel             `json:"channel"`
		Input   service.RunningHubInspectInput `json:"input"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
		Fail(w, "请求参数无效")
		return
	}
	entry, err := service.InspectAdminRunningHub(r.Context(), request.Index, request.Channel, request.Input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, entry)
}
